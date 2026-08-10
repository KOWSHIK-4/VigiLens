/**
 * Detector Engine v2 — Lifecycle unit tests.
 *
 * These tests exercise the pure lifecycle state machine (deriveLifecycleStatus)
 * and the in-memory LifecycleManager. They deliberately avoid touching the
 * database or the AI service.
 */

import { deriveLifecycleStatus, LifecycleManager } from "../src/engine/lifecycle";

let passed = 0;
let failed = 0;

function expectEqual(actual: unknown, expected: unknown, name: string) {
  if (actual === expected) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name} — expected "${expected}", got "${actual}"`);
  }
}

function expectTrue(actual: boolean, name: string) {
  if (actual) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`);
  }
}

function base() {
  return {
    installed: true,
    enabled: true,
    availability: "available" as const,
    modelStatus: "loaded",
    aiReachable: true,
    consecutiveFailures: 0,
    lastSuccessfulInferenceAt: "2026-08-10T00:00:00.000Z",
  };
}

function run() {
  console.log("Detector lifecycle status derivation:");

  // unconfigured
  expectEqual(
    deriveLifecycleStatus({ ...base(), installed: false }),
    "unconfigured",
    "not installed -> unconfigured",
  );
  expectEqual(
    deriveLifecycleStatus({ ...base(), availability: "unconfigured" }),
    "unconfigured",
    "definition without a model -> unconfigured",
  );

  // disabled / enabled
  expectEqual(
    deriveLifecycleStatus({ ...base(), enabled: false }),
    "disabled",
    "explicitly disabled -> disabled",
  );
  expectEqual(
    deriveLifecycleStatus({ ...base(), modelStatus: "disabled" }),
    "enabled",
    "installed, enabled, model not loaded -> enabled",
  );

  // loading / error / registered
  expectEqual(
    deriveLifecycleStatus({ ...base(), modelStatus: "loading" }),
    "loading",
    "model loading -> loading",
  );
  expectEqual(
    deriveLifecycleStatus({ ...base(), modelStatus: "error" }),
    "error",
    "model load failed -> error",
  );
  expectEqual(
    deriveLifecycleStatus({ ...base(), modelStatus: null }),
    "registered",
    "installed with no load state -> registered",
  );

  // unavailable
  expectEqual(
    deriveLifecycleStatus({ ...base(), aiReachable: false }),
    "unavailable",
    "AI backend unreachable -> unavailable",
  );

  // configured vs ready
  expectEqual(
    deriveLifecycleStatus({ ...base(), lastSuccessfulInferenceAt: null }),
    "configured",
    "loaded + enabled + never run -> configured",
  );
  expectEqual(
    deriveLifecycleStatus(base()),
    "ready",
    "loaded + enabled + successful run -> ready",
  );

  // failure streak escalation
  expectEqual(
    deriveLifecycleStatus({ ...base(), lastSuccessfulInferenceAt: null, consecutiveFailures: 3 }),
    "error",
    "3 consecutive failures without success -> error",
  );
  expectEqual(
    deriveLifecycleStatus({ ...base(), consecutiveFailures: 3 }),
    "ready",
    "3 failures but a past success still reports ready",
  );

  console.log("LifecycleManager state tracking:");

  const manager = new LifecycleManager();
  expectEqual(manager.consecutiveFailures("person"), 0, "fresh key has zero failures");

  manager.markInferenceFailed("person", "AI service unreachable", true);
  manager.markInferenceFailed("person", "AI service unreachable", true);
  expectEqual(manager.consecutiveFailures("person"), 2, "failures accumulate");
  expectTrue(manager.get("person").aiReachable === false, "unreachable flag recorded");
  expectTrue(manager.isInErrorState("person") === false, "not in error state at 2 failures");
  expectTrue(
    manager.get("person").lastError?.includes("unreachable") ?? false,
    "last error message recorded",
  );

  manager.markInferenceFailed("person", "timeout");
  expectTrue(manager.isInErrorState("person"), "in error state at 3 failures");

  manager.markInferenceSucceeded("person");
  expectEqual(manager.consecutiveFailures("person"), 0, "success resets failures");
  expectTrue(manager.get("person").lastError === null, "success clears last error");
  expectTrue(manager.get("person").aiReachable === true, "success marks AI reachable");
  expectTrue(
    manager.get("person").lastSuccessfulInferenceAt !== null,
    "success records lastSuccessfulInferenceAt",
  );

  manager.setEnabled("person", false);
  expectEqual(manager.get("person").enabled, false, "setEnabled(false) persisted");

  const snapshots = manager.snapshot();
  expectTrue(snapshots.length === 1, "snapshot contains tracked keys");

  console.log(`\nLifecycle tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
