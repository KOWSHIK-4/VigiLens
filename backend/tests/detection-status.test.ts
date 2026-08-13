import { deriveDetectionStatus } from "../src/services/detection.service";

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

function run() {
  expectEqual(deriveDetectionStatus(0.99), "critical", "confidence 0.99 -> critical");
  expectEqual(deriveDetectionStatus(0.85), "critical", "confidence 0.85 (boundary) -> critical");
  expectEqual(deriveDetectionStatus(0.84), "warning", "confidence 0.84 -> warning");
  expectEqual(deriveDetectionStatus(0.6), "warning", "confidence 0.6 (boundary) -> warning");
  expectEqual(deriveDetectionStatus(0.59), "info", "confidence 0.59 -> info");
  expectEqual(deriveDetectionStatus(0.0), "info", "confidence 0 -> info");

  console.log(`\nDetection status derivation tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
