/**
 * Detector Engine v2 — Post-processing.
 *
 * Applies confidence filtering and Non-Maximum Suppression (NMS) to the
 * raw model output so only the strongest, non-overlapping detections
 * proceed down the pipeline.
 */

import type { PipelineContext, RawDetection } from "./types";
import type { PostprocessingStage } from "./pipeline";
import { iou } from "./geometry";

/** Greedy per-class NMS — deterministic and dependency-free. */
export function nonMaximumSuppression(detections: RawDetection[], iouThreshold: number): RawDetection[] {
  const kept: RawDetection[] = [];
  const remaining = [...detections].sort((a, b) => b.confidence - a.confidence);

  while (remaining.length > 0) {
    const [best] = remaining.splice(0, 1);
    kept.push(best);
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (remaining[i].className === best.className && iou(remaining[i].bbox, best.bbox) >= iouThreshold) {
        remaining.splice(i, 1);
      }
    }
  }

  return kept;
}

export interface PostprocessStageOptions {
  iouThreshold?: number;
  /** Applies per-frame max detections (the per-detector max). */
  maxDetections?: number;
}

export class PostprocessStageImpl implements PostprocessingStage {
  readonly name = "postprocess";
  private readonly iouThreshold: number;

  constructor(options: PostprocessStageOptions = {}) {
    this.iouThreshold = options.iouThreshold ?? 0.45;
  }

  process(raw: RawDetection[], ctx: PipelineContext): RawDetection[] {
    const threshold = ctx.detector.confidenceThreshold / 100;
    const filtered = raw.filter((d) => d.confidence >= threshold);
    const suppressed = nonMaximumSuppression(filtered, this.iouThreshold);

    const max = ctx.detector.configuration.maxDetectionsPerFrame;
    return suppressed.slice(0, max);
  }
}
