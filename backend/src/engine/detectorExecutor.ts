/**
 * Detector Executor — the interface between the inference pipeline and a
 * concrete model backend.
 *
 * Every detector registered in the engine provides an executor. When a
 * trained model is not installed the engine still registers the detector
 * (so configuration and lifecycle work) but the executor is marked
 * unavailable and refuses to run inference — it never fabricates results.
 */

import { ApiError } from "@/utils/errors";
import type { FrameInput, RawDetection } from "./types";
import type { DetectorBackend } from "./pipeline";

/**
 * A DetectorExecutor owns the inference lifecycle for one detector:
 * initialisation, running inference on a frame, and teardown.
 */
export interface DetectorExecutor {
  readonly key: string;
  readonly available: boolean;
  initialize(): Promise<void>;
  infer(frame: FrameInput): Promise<RawDetection[]>;
  shutdown(): Promise<void>;
}

/** Executor used when a real trained model is not configured. */
export class UnconfiguredExecutor implements DetectorExecutor {
  readonly key: string;
  readonly available = false;

  constructor(key: string) {
    this.key = key;
  }

  async initialize(): Promise<void> {
    // Nothing to load — no model is available.
  }

  async infer(_frame: FrameInput): Promise<RawDetection[]> {
    throw new ApiError(
      501,
      `Detector "${this.key}" has no trained model configured. ` +
        "Install a model before running inference — the engine does not fabricate detections.",
    );
  }

  async shutdown(): Promise<void> {
    // Nothing to release.
  }
}

/** Adapts any executor into a pipeline `DetectorBackend`. */
export function toBackend(executor: DetectorExecutor): DetectorBackend {
  return {
    key: executor.key,
    available: executor.available,
    infer: (frame) => executor.infer(frame),
  };
}
