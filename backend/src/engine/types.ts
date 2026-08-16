/**
 * Detector Engine v2 — core domain types.
 *
 * These types describe the contracts used across every stage of the
 * multi-detector inference pipeline:
 *
 *   Camera/Input -> Frame Capture -> Preprocessing -> Detector Selection
 *     -> Inference -> Post-processing -> Confidence Filtering
 *     -> Object Tracking -> Detection Storage -> Alert Engine
 */

export type DetectorType =
  | "object_detection"
  | "classification"
  | "segmentation";

export type DetectorAvailability = "available" | "unconfigured";

/**
 * Detector engine lifecycle status.
 *
 *   registered  – installed model row exists, load has not started
 *   configured  – model loaded and enabled, live inference not yet verified
 *   enabled     – installed, turned on, model not loaded yet
 *   disabled    – turned off (explicitly disabled by a user)
 *   loading     – model weights are being loaded
 *   ready       – model loaded and a live inference run has succeeded
 *   error       – model load failed or consecutive engine runs failed
 *   unavailable – AI inference backend unreachable
 *   unconfigured– no installed model (no trained model, nothing to run)
 */
export type DetectorRuntimeStatus =
  | "registered"
  | "configured"
  | "enabled"
  | "disabled"
  | "loading"
  | "ready"
  | "error"
  | "unavailable"
  | "unconfigured";

export type ProcessingMode = "auto" | "gpu" | "cpu";

/** Axis-aligned bounding box in pixel coordinates (x1,y1,x2,y2). */
export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** Bounding box normalised to [0,1] relative to the source frame. */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-detector operational configuration. */
export interface DetectorConfiguration {
  confidenceThreshold: number;
  detectionIntervalMs: number;
  maxDetectionsPerFrame: number;
  alertSeverity: "info" | "warning" | "critical";
  alertCooldownMs: number;
  cameraIds: string[];
  inputResolution: string;
  processingMode: ProcessingMode;
}

/** A detector as exposed to the engine (unified runtime descriptor). */
export interface DetectorDescriptor {
  id: string;
  key: string;
  name: string;
  type: DetectorType;
  version: string;
  status: DetectorRuntimeStatus;
  /** Whether the detector is switched on (user preference from the DB). */
  enabled: boolean;
  availability: DetectorAvailability;
  confidenceThreshold: number;
  supportedInput: string[];
  configuration: DetectorConfiguration;
  modelVersion: string | null;
}

/** A raw object produced by a model before tracking/normalization. */
export interface RawDetection {
  className: string;
  confidence: number;
  bbox: BoundingBox;
}

/** A detection after object tracking has assigned an identity. */
export interface TrackedDetection extends RawDetection {
  trackId: string | null;
  objectId: string;
}

/** A fully normalised, persisted detection produced by the pipeline. */
export interface NormalizedDetection extends TrackedDetection {
  id?: string;
  cameraId: string;
  detectorId: string;
  detectorKey: string;
  timestamp: Date;
  normalized: NormalizedBox;
  processingTimeMs: number;
}

/** A camera source the engine can capture a frame from when no bytes are provided. */
export interface FrameSource {
  /** Camera URL passed to the AI service `/capture` endpoint. */
  url: string;
  /** Camera transport type (usb, rtsp, ip, video_file). */
  cameraType: string;
  /** Seek position for video_file cameras. */
  videoPosSeconds?: number;
}

/** A single frame entering the pipeline. */
export interface FrameInput {
  cameraId: string;
  detectorId: string;
  /** Detector descriptor resolved by the engine before running. */
  detector?: DetectorDescriptor;
  /** Raw encoded frame bytes (jpeg/png) or a pre-decoded buffer. */
  image: Buffer;
  /** Camera source used by the frame capture stage when `image` is empty. */
  source?: FrameSource;
  width?: number;
  height?: number;
  frameNumber: number;
}

/** Real, measured pipeline performance data (no fabricated values). */
export interface PipelineMetrics {
  framesProcessed: number;
  framesSkipped: number;
  inferenceTimeMs: number;
  preprocessingTimeMs: number;
  postprocessingTimeMs: number;
  trackingTimeMs: number;
  totalProcessingTimeMs: number;
  detectionsPerFrame: number;
  lastDetectionAt: Date | null;
  lastFrameAt: Date | null;
  lastSuccessfulInferenceAt: Date | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  errorCount: number;
}

/** Pipeline execution context shared across every stage. */
export interface PipelineContext {
  detector: DetectorDescriptor;
  cameraId: string;
  frameNumber: number;
  startedAt: [number, number];
  stageTimes: Record<string, number>;
  /** The frame being processed, when known to the stage. */
  frame?: FrameInput;
}

/** Generic interface for a single pipeline stage. */
export interface PipelineStage<I, O> {
  readonly name: string;
  process(input: I, ctx: PipelineContext): Promise<O> | O;
}

export const EMPTY_BOUNDING_BOX: BoundingBox = { x1: 0, y1: 0, x2: 0, y2: 0 };
