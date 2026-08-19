import { describe, it, expect } from "vitest";
import { iou } from "../src/engine/geometry";
import { nonMaximumSuppression, PostprocessStageImpl } from "../src/engine/postprocess";
import type {
  DetectorDescriptor,
  PipelineContext,
  RawDetection,
} from "../src/engine/types";

function detectorDescriptor(overrides: Partial<DetectorDescriptor> = {}): DetectorDescriptor {
  return {
    id: "det-1",
    key: "person",
    name: "Person Detection",
    type: "object_detection",
    version: "1.0.0",
    status: "ready",
    availability: "available",
    confidenceThreshold: 50,
    supportedInput: ["image"],
    modelVersion: "1.0.0",
    configuration: {
      confidenceThreshold: 50,
      detectionIntervalMs: 1000,
      maxDetectionsPerFrame: 10,
      alertSeverity: "warning",
      alertCooldownMs: 5000,
      cameraIds: ["demo-camera-1"],
      inputResolution: "640x640",
      processingMode: "auto",
    },
    ...overrides,
  };
}

function ctx(): PipelineContext {
  return {
    detector: detectorDescriptor(),
    cameraId: "demo-camera-1",
    frameNumber: 1,
    startedAt: process.hrtime(),
    stageTimes: {},
  };
}

function box(x1: number, y1: number, x2: number, y2: number) {
  return { x1, y1, x2, y2 };
}

describe("Engine Postprocess", () => {
  it("identical boxes have IoU 1", () => {
    expect(iou(box(0, 0, 10, 10), box(0, 0, 10, 10))).toBe(1);
  });

  it("disjoint boxes have IoU 0", () => {
    expect(iou(box(0, 0, 10, 10), box(100, 100, 110, 110))).toBe(0);
  });

  it("half-overlap IoU", () => {
    const halfOverlap = iou(box(0, 0, 10, 10), box(5, 0, 15, 10));
    const expected = 50 / 150;
    expect(Math.abs(halfOverlap - expected) < 1e-9).toBe(true);
  });

  it("NMS keeps strongest per cluster", () => {
    const overlapping: RawDetection[] = [
      { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
      { className: "person", confidence: 0.8, bbox: box(10, 10, 100, 100) },
      { className: "person", confidence: 0.7, bbox: box(200, 200, 300, 300) },
    ];
    const kept = nonMaximumSuppression(overlapping, 0.5);
    expect(kept.length).toBe(2);
  });

  it("NMS keeps highest confidence first", () => {
    const overlapping: RawDetection[] = [
      { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
      { className: "person", confidence: 0.8, bbox: box(10, 10, 100, 100) },
      { className: "person", confidence: 0.7, bbox: box(200, 200, 300, 300) },
    ];
    const kept = nonMaximumSuppression(overlapping, 0.5);
    expect(kept[0].confidence).toBe(0.9);
  });

  it("NMS is per-class", () => {
    const mixed: RawDetection[] = [
      { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
      { className: "vehicle", confidence: 0.4, bbox: box(0, 0, 100, 100) },
    ];
    expect(nonMaximumSuppression(mixed, 0.5).length).toBe(2);
  });

  it("stage drops detections below confidence threshold", () => {
    const stage = new PostprocessStageImpl({ iouThreshold: 0.5 });
    const raw = [
      { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
      { className: "person", confidence: 0.2, bbox: box(10, 10, 110, 110) },
    ];
    const filtered = stage.process(raw, ctx());
    expect(filtered.length).toBe(1);
  });

  it("stage keeps the strongest detection", () => {
    const stage = new PostprocessStageImpl({ iouThreshold: 0.5 });
    const raw = [
      { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
      { className: "person", confidence: 0.2, bbox: box(10, 10, 110, 110) },
    ];
    const filtered = stage.process(raw, ctx());
    expect(filtered[0].confidence).toBe(0.9);
  });

  it("stage caps detections per frame", () => {
    const stage = new PostprocessStageImpl({ iouThreshold: 0.5 });
    const cappedCtx = ctx();
    cappedCtx.detector = detectorDescriptor({
      configuration: {
        ...cappedCtx.detector.configuration,
        maxDetectionsPerFrame: 2,
      },
    });
    const many = Array.from({ length: 5 }, (_, i) => ({
      className: "person",
      confidence: 0.9 - i * 0.05,
      bbox: box(i * 200, 0, i * 200 + 50, 50),
    }));
    expect(stage.process(many, cappedCtx).length).toBe(2);
  });

  it("stage exposes its name", () => {
    const stage = new PostprocessStageImpl({ iouThreshold: 0.5 });
    expect(stage.name).toBe("postprocess");
  });
});
