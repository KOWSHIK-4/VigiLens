/**
 * Detector Engine v2 — Detection Normalization.
 *
 * Converts tracked detections into the canonical persisted form, adding
 * the camera/detector identity, a normalized box (0..1 relative to the
 * source frame) and the processing time measured by the pipeline.
 */

import type { NormalizationStage } from "./pipeline";
import type { FrameInput, NormalizedBox, NormalizedDetection, PipelineContext, TrackedDetection } from "./types";

function toNormalizedBox(bbox: TrackedDetection["bbox"], width: number, height: number): NormalizedBox {
  if (!width || !height) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.max(0, bbox.x1 / width);
  const y = Math.max(0, bbox.y1 / height);
  const w = Math.min(1, (bbox.x2 - bbox.x1) / width);
  const h = Math.min(1, (bbox.y2 - bbox.y1) / height);
  return { x: Math.min(x, 1), y: Math.min(y, 1), width: Math.max(0, Math.min(w, 1 - x)), height: Math.max(0, Math.min(h, 1 - y)) };
}

export class NormalizationStageImpl implements NormalizationStage {
  readonly name = "normalize";

  process(tracked: TrackedDetection[], ctx: PipelineContext): NormalizedDetection[] {
    const frame = ctx.frame as FrameInput | undefined;
    const width = frame?.width ?? 0;
    const height = frame?.height ?? 0;
    const processingTimeMs = ctx.stageTimes.totalProcessingTimeMs ?? 0;

    return tracked.map((detection, index) => ({
      ...detection,
      cameraId: ctx.cameraId,
      detectorId: ctx.detector.id,
      detectorKey: ctx.detector.key,
      timestamp: new Date(),
      normalized: toNormalizedBox(detection.bbox, width, height),
      processingTimeMs,
      objectId: detection.objectId ?? `${detection.className}:${index}`,
    }));
  }
}
