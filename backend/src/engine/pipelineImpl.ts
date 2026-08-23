/**
 * Detector Engine v2 — Pipeline Implementation.
 *
 * Concrete `PipelineBuilder` + `InferencePipeline` that wires the stages
 * declared in `pipeline.ts` and measures real, per-stage timing.
 */

import type {
  AlertEvaluationStage,
  FrameCaptureStage,
  InferencePipeline,
  InferenceStage,
  NormalizationStage,
  PersistenceStage,
  PipelineBuilder,
  PipelineResult,
  PostprocessingStage,
  PreprocessingStage,
  TrackingStage,
} from "./pipeline";
import type { FrameInput, NormalizedDetection, PipelineContext, PipelineMetrics, RawDetection, TrackedDetection } from "./types";

type StageName =
  | "frameCapture"
  | "preprocess"
  | "inference"
  | "postprocess"
  | "tracking"
  | "normalize"
  | "persist"
  | "alerts";

function nowTuple(): [number, number] {
  return process.hrtime();
}

function elapsedMs(startedAt: [number, number]): number {
  const [seconds, nanos] = process.hrtime(startedAt);
  return Math.round((seconds * 1000 + nanos / 1_000_000) * 100) / 100;
}

function zeroMetrics(): PipelineMetrics {
  return {
    framesProcessed: 0,
    framesSkipped: 0,
    inferenceTimeMs: 0,
    preprocessingTimeMs: 0,
    postprocessingTimeMs: 0,
    trackingTimeMs: 0,
    totalProcessingTimeMs: 0,
    detectionsPerFrame: 0,
    lastDetectionAt: null,
    lastFrameAt: null,
    lastSuccessfulInferenceAt: null,
    lastError: null,
    lastErrorAt: null,
    errorCount: 0,
  };
}

class StageRunner {
  private readonly stages: Record<StageName, unknown>;

  constructor() {
    this.stages = {} as Record<StageName, unknown>;
  }

  set<T>(name: string, stage: T): void {
    this.stages[name as StageName] = stage;
  }

  get<T>(name: StageName): T {
    return this.stages[name] as T;
  }
}

export class ConcretePipelineBuilder implements PipelineBuilder {
  private readonly runner = new StageRunner();
  private readonly state: PipelineMetrics = zeroMetrics();

  frameCapture(stage: FrameCaptureStage): PipelineBuilder {
    this.runner.set("frameCapture", stage);
    return this;
  }

  preprocess(stage: PreprocessingStage): PipelineBuilder {
    this.runner.set("preprocess", stage);
    return this;
  }

  inference(stage: InferenceStage): PipelineBuilder {
    this.runner.set("inference", stage);
    return this;
  }

  postprocess(stage: PostprocessingStage): PipelineBuilder {
    this.runner.set("postprocess", stage);
    return this;
  }

  tracking(stage: TrackingStage): PipelineBuilder {
    this.runner.set("tracking", stage);
    return this;
  }

  normalize(stage: NormalizationStage): PipelineBuilder {
    this.runner.set("normalize", stage);
    return this;
  }

  persist(stage: PersistenceStage): PipelineBuilder {
    this.runner.set("persist", stage);
    return this;
  }

  alerts(stage: AlertEvaluationStage): PipelineBuilder {
    this.runner.set("alerts", stage);
    return this;
  }

  build(): InferencePipeline {
    return new ConcretePipeline(this.runner, this.state);
  }
}

class ConcretePipeline implements InferencePipeline {
  private readonly runner: StageRunner;
  private readonly state: PipelineMetrics;

  constructor(runner: StageRunner, state: PipelineMetrics) {
    this.runner = runner;
    this.state = state;
  }

  metrics(): PipelineMetrics {
    return { ...this.state };
  }

  resetMetrics(): void {
    Object.assign(this.state, zeroMetrics());
  }

  async run(input: FrameInput): Promise<PipelineResult> {
    const startedAt = nowTuple();
    if (!input.detector) {
      throw new Error(`No detector descriptor provided for detector "${input.detectorId}"`);
    }
    const ctx: PipelineContext = {
      detector: input.detector,
      cameraId: input.cameraId,
      frameNumber: input.frameNumber,
      startedAt,
      stageTimes: {},
      frame: input,
    };

    try {
      let frame = input;
      let raw: RawDetection[] = [];
      let tracked: TrackedDetection[] = [];
      let detections: NormalizedDetection[] = [];

      const frameCapture = this.runner.get<FrameCaptureStage | undefined>("frameCapture");
      if (frameCapture) {
        const t = nowTuple();
        frame = await frameCapture.process(frame, ctx);
        ctx.frame = frame;
        ctx.stageTimes.frameCapture = elapsedMs(t);
      }

      const preprocess = this.runner.get<PreprocessingStage | undefined>("preprocess");
      if (preprocess) {
        const t = nowTuple();
        frame = await preprocess.process(frame, ctx);
        ctx.frame = frame;
        ctx.stageTimes.preprocess = elapsedMs(t);
      }

      const inference = this.runner.get<InferenceStage | undefined>("inference");
      if (inference) {
        const t = nowTuple();
        raw = await inference.process(frame, ctx);
        ctx.stageTimes.inference = elapsedMs(t);
      }

      const postprocess = this.runner.get<PostprocessingStage | undefined>("postprocess");
      if (postprocess) {
        const t = nowTuple();
        raw = await postprocess.process(raw, ctx);
        ctx.stageTimes.postprocess = elapsedMs(t);
      }

      const tracking = this.runner.get<TrackingStage | undefined>("tracking");
      if (tracking) {
        const t = nowTuple();
        tracked = await tracking.process(raw, ctx);
        ctx.stageTimes.tracking = elapsedMs(t);
      } else {
        tracked = raw.map((d, index) => ({ ...d, trackId: null, objectId: `${d.className}:${index}` }));
      }

      // Per-detection latency covers capture through tracking/normalization;
      // persistence and alerting happen afterwards and are not part of the
      // value stamped onto individual detection rows.
      const pipelineLatencyMs = elapsedMs(startedAt);
      ctx.stageTimes.totalProcessingTimeMs = pipelineLatencyMs;

      const normalize = this.runner.get<NormalizationStage | undefined>("normalize");
      if (normalize) {
        detections = await normalize.process(tracked, ctx);
      }

      const persist = this.runner.get<PersistenceStage | undefined>("persist");
      if (persist) {
        detections = await persist.persist(detections, ctx);
      }

      const alerts = this.runner.get<AlertEvaluationStage | undefined>("alerts");
      if (alerts) {
        await alerts.evaluate(detections, ctx);
      }

      // Update rolling metrics with real measured values.
      this.state.framesProcessed += 1;
      this.state.lastFrameAt = new Date();
      this.state.lastSuccessfulInferenceAt = new Date();
      this.state.lastError = null;
      this.state.lastErrorAt = null;
      this.state.inferenceTimeMs = ctx.stageTimes.inference ?? this.state.inferenceTimeMs;
      this.state.preprocessingTimeMs = ctx.stageTimes.preprocess ?? this.state.preprocessingTimeMs;
      this.state.postprocessingTimeMs = ctx.stageTimes.postprocess ?? this.state.postprocessingTimeMs;
      this.state.trackingTimeMs = ctx.stageTimes.tracking ?? this.state.trackingTimeMs;
      // Metrics-level total is the true end-to-end frame wall time,
      // measured after every stage (including persistence and alerting).
      this.state.totalProcessingTimeMs = elapsedMs(startedAt);
      this.state.detectionsPerFrame = detections.length;
      if (detections.length > 0) {
        this.state.lastDetectionAt = new Date();
      }

      return { detections, metrics: this.metrics(), processedAt: new Date() };
    } catch (err) {
      this.state.errorCount += 1;
      this.state.framesSkipped += 1;
      this.state.lastError = err instanceof Error ? err.message : "unknown pipeline error";
      this.state.lastErrorAt = new Date();
      throw err;
    }
  }
}
