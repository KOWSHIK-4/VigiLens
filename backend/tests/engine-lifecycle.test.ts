import {
  LifecycleManager,
  deriveLifecycleStatus,
  MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR,
  REACHABILITY_PROBE_TTL_MS,
  type LifecycleDerivationInput,
} from "../src/engine/lifecycle";

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
  if (actual === expected) {
    ok(name, `${String(expected)}`);
  } else {
    fail(name, `expected ${String(expected)}, got ${String(actual)}`);
  }
}

function loadedInput(overrides: Partial<LifecycleDerivationInput> = {}): LifecycleDerivationInput {
  return {
    installed: true,
    enabled: true,
    availability: "available",
    modelStatus: "loaded",
    aiReachable: true,
    consecutiveFailures: 0,
    lastSuccessfulInferenceAt: "2026-08-09T12:00:00.000Z",
    ...overrides,
  };
}

// --- deriveLifecycleStatus ---

expectEqual(deriveLifecycleStatus({ ...loadedInput(), installed: false }), "unconfigured", "not installed → unconfigured");
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), availability: "unconfigured" }),
  "unconfigured",
  "unconfigured availability → unconfigured",
);
expectEqual(deriveLifecycleStatus({ ...loadedInput(), enabled: false }), "disabled", "disabled → disabled");
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), modelStatus: "disabled" }),
  "enabled",
  "loaded+enabled but model disabled → enabled",
);
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), modelStatus: "loading" }),
  "loading",
  "model loading → loading",
);
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), modelStatus: "error" }),
  "error",
  "model error → error",
);
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), modelStatus: "pending" }),
  "registered",
  "unknown model status → registered",
);
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), aiReachable: false }),
  "unavailable",
  "AI backend unreachable → unavailable",
);
expectEqual(
  deriveLifecycleStatus({
    ...loadedInput(),
    consecutiveFailures: MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR,
    lastSuccessfulInferenceAt: null,
  }),
  "error",
  "3+ failures without a success → error",
);
expectEqual(
  deriveLifecycleStatus({ ...loadedInput(), lastSuccessfulInferenceAt: null, consecutiveFailures: 1 }),
  "configured",
  "loaded but never ran → configured",
);
expectEqual(
  deriveLifecycleStatus(loadedInput()),
  "ready",
  "loaded with a successful run → ready",
);

// --- LifecycleManager ---

const manager = new LifecycleManager();
const key = "person";

const fresh = manager.get("vehicle");
expectEqual(fresh.enabled, true, "fresh state is enabled");
expectEqual(fresh.lastInferenceAt, null, "fresh state has no last inference");
expectEqual(fresh.aiReachable, null, "fresh state has unknown reachability");
expectEqual(fresh.consecutiveFailures, 0, "fresh state has zero failures");

expectEqual(manager.isProbeDue(key), true, "probe is due before any probe");

manager.markInferenceSucceeded(key);
let state = manager.get(key);
expectEqual(state.consecutiveFailures, 0, "success resets failure streak");
expectEqual(state.lastError, null, "success clears last error");
expectEqual(state.aiReachable, true, "success marks AI reachable");
expectEqual(state.lastSuccessfulInferenceAt != null, true, "success records last successful inference");
expectEqual(manager.isInErrorState(key), false, "not in error state after success");

manager.markInferenceFailed(key, "boom");
state = manager.get(key);
expectEqual(state.consecutiveFailures, 1, "failure increments streak");
expectEqual(state.lastError, "boom", "failure records error message");
expectEqual(state.lastErrorAt != null, true, "failure records error time");

manager.recordReachabilityProbe(key, false);
state = manager.get(key);
expectEqual(state.aiReachable, false, "probe records unreachable");
expectEqual(state.lastProbeAt != null, true, "probe records probe time");
expectEqual(manager.isProbeDue(key), false, "probe not due after fresh probe");

state.lastProbeAt = Date.now() - REACHABILITY_PROBE_TTL_MS - 1;
expectEqual(manager.isProbeDue(key), true, "probe due after TTL expires");

manager.markInferenceFailed(key, "again");
manager.markInferenceFailed(key, "thrice");
state = manager.get(key);
expectEqual(state.consecutiveFailures, MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR, "streak accumulates");
expectEqual(manager.isInErrorState(key), true, "in error state after 3 consecutive failures");

manager.markInferenceFailed(key, "fourth", true);
state = manager.get(key);
expectEqual(state.consecutiveFailures, MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR + 1, "streak keeps counting");
expectEqual(state.aiReachable, false, "aiUnreachable failure marks AI unreachable");

manager.setEnabled(key, false);
state = manager.get(key);
expectEqual(state.enabled, false, "setEnabled false persists");

manager.markInferenceSucceeded(key);
state = manager.get(key);
expectEqual(state.enabled, false, "success does not re-enable a disabled detector");

manager.setEnabled(key, true);
state = manager.get(key);
expectEqual(state.enabled, true, "setEnabled true persists");
expectEqual(state.consecutiveFailures, 0, "re-enabling clears the failure streak");

const snapshot = manager.snapshot();
expectEqual(snapshot.length >= 1, true, "snapshot includes tracked detectors");
expectEqual(snapshot.some((s) => s.key === key), true, "snapshot includes the person key");
expectEqual(snapshot[0] !== manager.get(key), true, "snapshot returns copies");

manager.reset(key);
expectEqual(manager.get(key).consecutiveFailures, 0, "reset restores fresh state");
expectEqual(manager.isProbeDue(key), true, "reset makes probe due again");

console.log(`\nEngine lifecycle tests: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
