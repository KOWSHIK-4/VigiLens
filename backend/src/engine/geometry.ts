/**
 * Detector Engine v2 — Geometry helpers.
 */

import type { BoundingBox } from "./types";

/** Intersection over Union between two axis-aligned bounding boxes. */
export function iou(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - intersection;
  return union <= 0 ? 0 : intersection / union;
}

export function boxCenter(box: BoundingBox): { cx: number; cy: number } {
  return { cx: (box.x1 + box.x2) / 2, cy: (box.y1 + box.y2) / 2 };
}
