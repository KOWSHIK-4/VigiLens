import { iou } from "../src/engine/geometry";
import { nonMaximumSuppression, PostprocessStageImpl } from "../src/engine/postprocess";
import type {
  DetectorDescriptor,
  PipelineContext,
  RawDetection,
} from "../src/engine/types";

let passed = 0;
let failed = 0;

function ok(name: string, details?: string) {
  passed += 1;
  console.log(`  PASS  ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name: string, details?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
}

function expectEqual(actual: unknown, expected: unknown, name: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    ok(name);
  } else {
    fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

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

function run() {
  // --- iou ---
  expectEqual(iou(box(0, 0, 10, 10), box(0, 0, 10, 10)), 1, "identical boxes have IoU 1");
  expectEqual(iou(box(0, 0, 10, 10), box(100, 100, 110, 110)), 0, "disjoint boxes have IoU 0");

  const halfOverlap = iou(box(0, 0, 10, 10), box(5, 0, 15, 10));
  const expected = 50 / 150;
  ok(Math.abs(halfOverlap - expected) < 1e-9, `half-overlap IoU ${halfOverlap.toFixed(3)}`);

  // --- nonMaximumSuppression ---
  const overlapping: RawDetection[] = [
    { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
    { className: "person", confidence: 0.8, bbox: box(10, 10, 100, 100) },
    { className: "person", confidence: 0.7, bbox: box(200, 200, 300, 300) },
  ];
  const kept = nonMaximumSuppression(overlapping, 0.5);
  expectEqual(kept.length, 2, "NMS keeps strongest per cluster");
  expectEqual(kept[0].confidence, 0.9, "NMS keeps highest confidence first");

  // Different classes are never suppressed against each other.
  const mixed: RawDetection[] = [
    { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
    { className: "vehicle", confidence: 0.4, bbox: box(0, 0, 100, 100) },
  ];
  expectEqual(nonMaximumSuppression(mixed, 0.5).length, 2, "NMS is per-class");

  // --- PostprocessStageImpl ---
  const stage = new PostprocessStageImpl({ iouThreshold: 0.5 });

  const raw = [
    { className: "person", confidence: 0.9, bbox: box(0, 0, 100, 100) },
    { className: "person", confidence: 0.2, bbox: box(10, 10, 110, 110) },
  ];
  const filtered = stage.process(raw, ctx());
  expectEqual(filtered.length, 1, "stage drops detections below confidence threshold");
  expectEqual(filtered[0].confidence, 0.9, "stage keeps the strongest detection");

  // maxDetectionsPerFrame cap.
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
  expectEqual(stage.process(many, cappedCtx).length, 2, "stage caps detections per frame");

  // Stage name.
  expectEqual(stage.name, "postprocess", "stage exposes its name");

  console.log(`\nEngine postprocess tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
