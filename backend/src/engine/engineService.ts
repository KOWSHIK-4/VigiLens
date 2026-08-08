/**
 * Detector Engine v2 — Engine Service.
 *
 * Assembles a runnable `InferencePipeline` with real stages wired to the
 * AI inference service, the detection persistence service and the alert
 * service (with per-detector cooldown). Executes frames through the
 * pipeline and exposes measured performance data.
 */

import { ApiError } from "@/utils/errors";
import { detectionService } from "@/services/detection.service";
import { metricsService } from "@/services/metrics.service";
import { aiServiceClient, type AiServiceClient } from "./aiClient";
import { runtimeRegistry } from "./runtimeRegistry";
import { ConcretePipelineBuilder } from "./pipelineImpl";
import { PostprocessStageImpl } from "./postprocess";
import { IouTracker, type ObjectTracker } from "./tracking";
import { NormalizationStageImpl } from "./normalize";
import { CooldownAlertStage } from "./alerts";
import type {
  FrameInput,
  NormalizedDetection,
  PipelineContext,
  PipelineMetrics,
  RawDetection,
} from "./types";
import type {
  InferencePipeline,
  InferenceStage,
  PersistenceStage,
  PipelineResult,
  PreprocessingStage,
  TrackingStage,
} from "./pipeline";

/**
 * Maps backend detector keys to the registered AI service model. Keys
 * without an entry have no real model and are handled by the
 * `UnconfiguredExecutor` path.
 */
const AI_DETECTOR_MODELS: Record<string, string> = {
  person: "person_detector",
  vehicle: "vehicle_detector",
};

/** Preprocessing: pass-through stage (real decoding happens in AI service). */
class PassThroughPreprocessStage implements PreprocessingStage {
  readonly name = "preprocess";

  process(frame: FrameInput, _ctx: PipelineContext): FrameInput {
    return frame;
  }
}

/** Inference stage backed by the real AI service HTTP client. */
class AiInferenceStage implements InferenceStage {
  readonly name = "inference";
  private readonly client: AiServiceClient;

  constructor(client: AiServiceClient) {
    this.client = client;
  }

  async process(frame: FrameInput, ctx: PipelineContext): Promise<RawDetection[]> {
    const model = AI_DETECTOR_MODELS[ctx.detector.key];
    if (!model) {
      throw new Error(
        `No AI model configured for detector "${ctx.detector.key}" — the engine does not fabricate detections.`,
      );
    }
    if (!(await this.client.isReachable())) {
      throw new Error("AI service is unreachable");
    }

    const result = await this.client.detectImage(frame.image, model);
    if (result.image_width && result.image_height) {
      frame.width = result.image_width;
      frame.height = result.image_height;
    }
    return result.detections.map((d) => ({
      className: d.class_name,
      confidence: d.confidence,
      bbox: d.bbox,
    }));
  }
}

/** Persistence stage: stores qualifying detections via detectionService. */
class DetectionPersistenceStage implements PersistenceStage {
  async persist(detections: NormalizedDetection[], ctx: PipelineContext): Promise<NormalizedDetection[]> {
    const persisted: NormalizedDetection[] = [];
    for (const d of detections) {
      const created = await detectionService.create({
        cameraId: d.cameraId,
        label: d.className,
        confidence: d.confidence,
        detectorId: d.detectorId,
        detectorKey: d.detectorKey,
        modelVersion: ctx.detector.modelVersion ?? undefined,
        trackId: d.trackId ?? undefined,
        className: d.className,
        boundingBox: { x1: d.bbox.x1, y1: d.bbox.y1, x2: d.bbox.x2, y2: d.bbox.y2 },
        snapshotUrl: undefined,
        processingTimeMs: Math.round(d.processingTimeMs),
        metadata: {
          detector: ctx.detector.key,
          trackId: d.trackId,
          normalized: d.normalized,
          source: "detector-engine",
        },
        skipAlert: true,
      });
      persisted.push({ ...d, id: created.id });
    }
    return persisted;
  }
}

class EngineServiceImpl {
  private readonly client: AiServiceClient;
  private readonly metricsByKey = new Map<string, PipelineMetrics>();

  constructor(client: AiServiceClient) {
    this.client = client;
  }

  async isDetectorRunnable(key: string): Promise<boolean> {
    return Boolean(AI_DETECTOR_MODELS[key]);
  }

  buildPipeline(): InferencePipeline {
    const tracker: ObjectTracker = new IouTracker();

    const pipeline = new ConcretePipelineBuilder()
      .preprocess(new PassThroughPreprocessStage())
      .inference(new AiInferenceStage(this.client))
      .postprocess(new PostprocessStageImpl())
      .tracking(
        new (class implements TrackingStage {
          readonly name = "tracking";
          process(raw: RawDetection[], _ctx: PipelineContext) {
            return tracker.update(raw, Date.now());
          }
        })(),
      )
      .normalize(new NormalizationStageImpl())
      .persist(new DetectionPersistenceStage())
      .alerts(new CooldownAlertStage())
      .build();

    return pipeline;
  }

  /** Run a single frame through the engine for a detector key. */
  async processFrame(key: string, cameraId: string, image: Buffer): Promise<PipelineResult> {
    const descriptor = await runtimeRegistry.describeByKey(key);
    if (!descriptor) {
      throw new ApiError(404, `Unknown detector key "${key}"`);
    }
    if (descriptor.availability === "unconfigured") {
      throw new ApiError(
        501,
        `Detector "${key}" has no trained model installed. ` +
          "The engine does not fabricate detections — install a model first.",
        { code: "DETECTOR_UNCONFIGURED" },
      );
    }
    if (descriptor.status === "disabled") {
      throw new ApiError(
        409,
        `Detector "${key}" is disabled. Enable it before running inference.`,
        { code: "DETECTOR_DISABLED" },
      );
    }

    const pipeline = this.buildPipeline();
    const input: FrameInput = {
      cameraId,
      detectorId: descriptor.id,
      detector: descriptor,
      image,
      frameNumber: 1,
    };

    try {
      const startedAt = process.hrtime.bigint();
      const result = await pipeline.run(input);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      metricsService.recordDetection(durationMs);
      this.recordMetrics(key, result.metrics);
      return result;
    } catch (err) {
      this.recordError(key);
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        502,
        `Inference failed for detector "${key}": ${err instanceof Error ? err.message : "unknown error"}`,
        { code: "DETECTOR_INFERENCE_FAILED" },
      );
    }
  }

  private recordMetrics(key: string, incoming: PipelineMetrics): void {
    const prev = this.metricsByKey.get(key);
    if (!prev) {
      this.metricsByKey.set(key, { ...incoming });
      return;
    }
    prev.framesProcessed = incoming.framesProcessed;
    prev.framesSkipped = prev.framesSkipped + incoming.framesSkipped;
    prev.inferenceTimeMs = incoming.inferenceTimeMs;
    prev.preprocessingTimeMs = incoming.preprocessingTimeMs;
    prev.postprocessingTimeMs = incoming.postprocessingTimeMs;
    prev.trackingTimeMs = incoming.trackingTimeMs;
    prev.totalProcessingTimeMs = incoming.totalProcessingTimeMs;
    prev.detectionsPerFrame = incoming.detectionsPerFrame;
    prev.lastDetectionAt = incoming.lastDetectionAt;
    prev.lastFrameAt = incoming.lastFrameAt;
    prev.errorCount = prev.errorCount + incoming.errorCount;
    this.metricsByKey.set(key, prev);
  }

  private recordError(key: string): void {
    const prev = this.metricsByKey.get(key);
    if (prev) {
      prev.errorCount += 1;
      prev.framesSkipped += 1;
    }
  }

  /** Real per-detector metrics accumulated from engine runs. */
  async getMetrics(key: string): Promise<PipelineMetrics | null> {
    const descriptor = await runtimeRegistry.describeByKey(key);
    if (!descriptor) return null;
    return this.metricsByKey.get(key) ?? null;
  }
}

export const engineService = new EngineServiceImpl(aiServiceClient);
