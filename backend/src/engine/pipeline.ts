/**
 * Detector Engine v2 — Inference Pipeline.
 *
 * The pipeline is composed of clearly separated stages. Every stage
 * implements `PipelineStage<I, O>` and the orchestrator wires them in
 * order. A new stage (or a new detector backend) can be plugged in
 * without touching the rest of the engine.
 *
 *   FrameInput -> Preprocess -> Inference -> PostProcess (NMS + filter)
 *     -> Tracking -> Normalize -> Persist -> Alert
 */

import type {
  FrameInput,
  NormalizedDetection,
  PipelineContext,
  PipelineMetrics,
  PipelineStage,
  RawDetection,
  TrackedDetection,
} from "./types";

/** 1. Frame input — captures/normalises the raw frame for processing. */
export type FrameCaptureStage = PipelineStage<FrameInput, FrameInput>;

/** 2. Preprocessing — resize, letterbox, colour conversion, etc. */
export type PreprocessingStage = PipelineStage<FrameInput, FrameInput>;

/**
 * 3. Detector selection — picks the concrete model backend for the
 *    detector key (AI service, local model, or unconfigured placeholder).
 */
export interface DetectorSelectionStage {
  select(detectorKey: string): DetectorBackend;
}

/** 4. Inference — runs the model and returns raw detections. */
export type InferenceStage = PipelineStage<FrameInput, RawDetection[]>;

/** 5. Post-processing — applies confidence filtering + NMS. */
export type PostprocessingStage = PipelineStage<RawDetection[], RawDetection[]>;

/** 6. Object tracking — assigns track identities to detections. */
export type TrackingStage = PipelineStage<RawDetection[], TrackedDetection[]>;

/** 7. Detection normalization — converts boxes to a canonical form. */
export type NormalizationStage = PipelineStage<TrackedDetection[], NormalizedDetection[]>;

/** 8. Persistence — stores qualifying detections and returns them with ids. */
export interface PersistenceStage {
  persist(detections: NormalizedDetection[], ctx: PipelineContext): Promise<NormalizedDetection[]>;
}

/** 9. Alert evaluation — raises alerts for qualifying detections. */
export interface AlertEvaluationStage {
  evaluate(detections: NormalizedDetection[], ctx: PipelineContext): Promise<void>;
}

/** A concrete detector backend selected by the engine. */
export interface DetectorBackend {
  readonly key: string;
  readonly available: boolean;
  infer(frame: FrameInput): Promise<RawDetection[]>;
}

/** Result of a full pipeline execution. */
export interface PipelineResult {
  detections: NormalizedDetection[];
  metrics: PipelineMetrics;
  processedAt: Date;
}

/**
 * A builder collects the pipeline stages and produces a runnable
 * pipeline. This keeps stage construction decoupled from execution.
 */
export interface PipelineBuilder {
  frameCapture(stage: FrameCaptureStage): PipelineBuilder;
  preprocess(stage: PreprocessingStage): PipelineBuilder;
  inference(stage: InferenceStage): PipelineBuilder;
  postprocess(stage: PostprocessingStage): PipelineBuilder;
  tracking(stage: TrackingStage): PipelineBuilder;
  normalize(stage: NormalizationStage): PipelineBuilder;
  persist(stage: PersistenceStage): PipelineBuilder;
  alerts(stage: AlertEvaluationStage): PipelineBuilder;
  build(): InferencePipeline;
}

/** The assembled, runnable inference pipeline. */
export interface InferencePipeline {
  run(input: FrameInput): Promise<PipelineResult>;
  metrics(): PipelineMetrics;
  resetMetrics(): void;
}
