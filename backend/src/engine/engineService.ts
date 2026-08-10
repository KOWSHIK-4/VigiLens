/**
 * Detector Engine v2 — Engine Service.
 *
 * Assembles a runnable `InferencePipeline` with real stages wired to the
 * AI inference service, the detection persistence service and the alert
 * service (with per-detector cooldown). Executes frames through the
 * pipeline and exposes measured performance data.
 */

import { ApiError } from "@/utils/errors";
import { logger } from "@/config/logger";
import { detectionService } from "@/services/detection.service";
import { metricsService } from "@/services/metrics.service";
import { aiServiceClient, AiServiceError, type AiServiceClient } from "./aiClient";
import { runtimeRegistry } from "./runtimeRegistry";
import { lifecycleManager } from "./lifecycle";
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
  async processFrame(key: string, cameraId: string, image: Buffer, options: { force?: boolean } = {}): Promise<PipelineResult> {
    if (!image || image.length === 0) {
      throw new ApiError(400, "Empty frame buffer cannot be processed", { code: "INVALID_FRAME" });
    }

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
    if (descriptor.status === "unavailable") {
      throw new ApiError(
        503,
        `Detector "${key}" is unavailable: the AI inference backend is unreachable.`,
        { code: "DETECTOR_UNAVAILABLE" },
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
      lifecycleManager.markInferenceSucceeded(key);
      logger.info("Engine frame processed", {
        key,
        cameraId,
        detections: result.detections.length,
        durationMs: Math.round(durationMs),
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown engine error";
      const unreachable =
        err instanceof AiServiceError && err.reason === "unreachable"
          ? true
          : message.toLowerCase().includes("unreachable");
      this.recordError(key, message);
      lifecycleManager.markInferenceFailed(key, message, unreachable);
      logger.error("Engine frame processing failed", { key, cameraId, message });
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        502,
        `Inference failed for detector "${key}": ${message}`,
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
    prev.framesProcessed = prev.framesProcessed + incoming.framesProcessed;
    prev.framesSkipped = prev.framesSkipped + incoming.framesSkipped;
    prev.inferenceTimeMs = incoming.inferenceTimeMs;
    prev.preprocessingTimeMs = incoming.preprocessingTimeMs;
    prev.postprocessingTimeMs = incoming.postprocessingTimeMs;
    prev.trackingTimeMs = incoming.trackingTimeMs;
    prev.totalProcessingTimeMs = incoming.totalProcessingTimeMs;
    prev.detectionsPerFrame = incoming.detectionsPerFrame;
    prev.lastDetectionAt = incoming.lastDetectionAt;
    prev.lastFrameAt = incoming.lastFrameAt;
    prev.lastSuccessfulInferenceAt = incoming.lastSuccessfulInferenceAt;
    prev.lastError = incoming.lastError;
    prev.lastErrorAt = incoming.lastErrorAt;
    prev.errorCount = prev.errorCount + incoming.errorCount;
    this.metricsByKey.set(key, prev);
  }

  private recordError(key: string, message: string): void {
    const prev = this.metricsByKey.get(key);
    if (prev) {
      prev.errorCount += 1;
      prev.framesSkipped += 1;
      prev.lastError = message;
      prev.lastErrorAt = new Date();
    } else {
      this.metricsByKey.set(key, {
        framesProcessed: 0,
        framesSkipped: 1,
        inferenceTimeMs: 0,
        preprocessingTimeMs: 0,
        postprocessingTimeMs: 0,
        trackingTimeMs: 0,
        totalProcessingTimeMs: 0,
        detectionsPerFrame: 0,
        lastDetectionAt: null,
        lastFrameAt: new Date(),
        lastSuccessfulInferenceAt: null,
        lastError: message,
        lastErrorAt: new Date(),
        errorCount: 1,
      });
    }
  }

  /** Real per-detector metrics accumulated from engine runs. */
  async getMetrics(key: string): Promise<PipelineMetrics | null> {
    const descriptor = await runtimeRegistry.describeByKey(key);
    if (!descriptor) return null;
    return this.metricsByKey.get(key) ?? null;
  }

  /**
   * Structured health view merging accumulated engine metrics with the
   * lifecycle state (reachability, last error, failure streak). Consumers
   * must never see fabricated latency/throughput values.
   */
  async getHealth(key: string) {
    const descriptor = await runtimeRegistry.describeByKey(key);
    if (!descriptor) return null;
    const metrics = this.metricsByKey.get(key);
    const lifecycle = lifecycleManager.get(key);

    const latencyMs = metrics && metrics.framesProcessed > 0 ? metrics.inferenceTimeMs : null;
    const elapsedSinceLastFrame =
      metrics?.lastFrameAt != null ? Date.now() - metrics.lastFrameAt.getTime() : null;
    const throughputFps =
      metrics && metrics.framesProcessed > 0 && elapsedSinceLastFrame !== null && elapsedSinceLastFrame > 0
        ? Math.round((metrics.framesProcessed / elapsedSinceLastFrame) * 1000 * 10) / 10
        : null;

    return {
      key: descriptor.key,
      status: descriptor.status,
      enabled: descriptor.enabled,
      healthy: descriptor.status === "ready" || descriptor.status === "configured",
      message:
        descriptor.status === "ready"
          ? "Detector is ready and running live inference"
          : descriptor.status === "configured"
            ? "Detector is configured but has not run yet"
            : descriptor.status === "disabled"
              ? "Detector is disabled"
              : descriptor.status === "unavailable"
                ? "AI inference backend is unreachable"
                : descriptor.status === "error"
                  ? "Detector is in an error state"
                  : descriptor.status === "loading"
                    ? "Detector model is loading"
                    : descriptor.status === "unconfigured"
                      ? "No trained model installed"
                      : `Detector lifecycle: ${descriptor.status}`,
      latencyMs,
      throughputFps,
      framesProcessed: metrics?.framesProcessed ?? 0,
      framesSkipped: metrics?.framesSkipped ?? 0,
      errorCount: metrics?.errorCount ?? 0,
      lastInferenceAt: lifecycle.lastInferenceAt,
      lastSuccessfulInferenceAt: lifecycle.lastSuccessfulInferenceAt,
      lastError: lifecycle.lastError,
      lastErrorAt: lifecycle.lastErrorAt,
      consecutiveFailures: lifecycle.consecutiveFailures,
      aiReachable: lifecycle.aiReachable,
      lastDetectionAt: metrics?.lastDetectionAt?.toISOString() ?? null,
      lastFrameAt: metrics?.lastFrameAt?.toISOString() ?? null,
    };
  }
}

export const engineService = new EngineServiceImpl(aiServiceClient);
