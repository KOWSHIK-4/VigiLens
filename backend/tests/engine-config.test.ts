import {
  validateDetectorConfiguration,
  hasCamera,
  withCamera,
} from "../src/engine/configuration";

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
    ok(name, `${JSON.stringify(expected)}`);
  } else {
    fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function valid() {
  return {
    confidenceThreshold: 50,
    detectionIntervalMs: 1000,
    maxDetectionsPerFrame: 20,
    alertSeverity: "warning",
    alertCooldownMs: 5000,
    cameraIds: ["demo-camera-1"],
    inputResolution: "640x640",
    processingMode: "auto",
  };
}

function run() {
  const cfg = validateDetectorConfiguration(valid());
  expectEqual(cfg.processingMode, "auto", "valid configuration is accepted");
  expectEqual(cfg.maxDetectionsPerFrame, 20, "parses int fields");

  // Unknown keys are stripped.
  const stripped = validateDetectorConfiguration({ ...valid(), bogus: true });
  expectEqual("bogus" in stripped, false, "unknown keys are stripped");

  // Boundary values.
  const bounds = validateDetectorConfiguration({
    ...valid(),
    confidenceThreshold: 0,
    alertCooldownMs: 0,
    cameraIds: [],
  });
  ok(
    bounds.confidenceThreshold === 0 && bounds.alertCooldownMs === 0 && bounds.cameraIds.length === 0,
    "minimum boundary values accepted",
  );

  const maxed = validateDetectorConfiguration({
    ...valid(),
    confidenceThreshold: 100,
    detectionIntervalMs: 600000,
    maxDetectionsPerFrame: 100,
    alertCooldownMs: 3600000,
  });
  ok(
    maxed.confidenceThreshold === 100 && maxed.detectionIntervalMs === 600000 && maxed.maxDetectionsPerFrame === 100,
    "maximum boundary values accepted",
  );

  // Invalid values rejected.
  const badThreshold = () => validateDetectorConfiguration({ ...valid(), confidenceThreshold: 150 });
  let rejected = false;
  try {
    badThreshold();
  } catch {
    rejected = true;
  }
  ok(rejected, "confidenceThreshold > 100 rejected");

  const badInterval = () => validateDetectorConfiguration({ ...valid(), detectionIntervalMs: 50 });
  rejected = false;
  try {
    badInterval();
  } catch {
    rejected = true;
  }
  ok(rejected, "detectionIntervalMs < 100 rejected");

  const badSeverity = () => validateDetectorConfiguration({ ...valid(), alertSeverity: "fatal" });
  rejected = false;
  try {
    badSeverity();
  } catch {
    rejected = true;
  }
  ok(rejected, "unknown alertSeverity rejected");

  const badResolution = () => validateDetectorConfiguration({ ...valid(), inputResolution: "640" });
  rejected = false;
  try {
    badResolution();
  } catch {
    rejected = true;
  }
  ok(rejected, "malformed inputResolution rejected");

  const badMode = () => validateDetectorConfiguration({ ...valid(), processingMode: "quantum" });
  rejected = false;
  try {
    badMode();
  } catch {
    rejected = true;
  }
  ok(rejected, "unknown processingMode rejected");

  const tooManyCameras = () =>
    validateDetectorConfiguration({
      ...valid(),
      cameraIds: Array.from({ length: 101 }, (_, i) => `cam-${i}`),
    });
  rejected = false;
  try {
    tooManyCameras();
  } catch {
    rejected = true;
  }
  ok(rejected, "> 100 camera ids rejected");

  // Camera assignment helpers.
  ok(hasCamera(cfg, "demo-camera-1"), "hasCamera true for assigned camera");
  ok(!hasCamera(cfg, "demo-camera-2"), "hasCamera false for unassigned camera");

  const added = withCamera(cfg, "demo-camera-2", true);
  ok(hasCamera(added, "demo-camera-2"), "withCamera adds an assignment");
  expectEqual(cfg.cameraIds.length, 1, "withCamera does not mutate original");

  const deduped = withCamera(cfg, "demo-camera-1", true);
  expectEqual(deduped.cameraIds.length, 1, "withCamera dedupes existing assignment");

  const removed = withCamera(added, "demo-camera-1", false);
  ok(!hasCamera(removed, "demo-camera-1"), "withCamera removes an assignment");

  console.log(`\nEngine config tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
