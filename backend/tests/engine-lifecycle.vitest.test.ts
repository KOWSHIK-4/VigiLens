import { describe, it, expect } from "vitest";
import {
  LifecycleManager,
  deriveLifecycleStatus,
  MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR,
  REACHABILITY_PROBE_TTL_MS,
  type LifecycleDerivationInput,
} from "../src/engine/lifecycle";

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

describe("deriveLifecycleStatus", () => {
  it("not installed → unconfigured", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), installed: false })).toBe("unconfigured");
  });

  it("unconfigured availability → unconfigured", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), availability: "unconfigured" })).toBe("unconfigured");
  });

  it("disabled → disabled", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), enabled: false })).toBe("disabled");
  });

  it("loaded+enabled but model disabled → enabled", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), modelStatus: "disabled" })).toBe("enabled");
  });

  it("model loading → loading", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), modelStatus: "loading" })).toBe("loading");
  });

  it("model error → error", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), modelStatus: "error" })).toBe("error");
  });

  it("unknown model status → registered", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), modelStatus: "pending" })).toBe("registered");
  });

  it("AI backend unreachable → unavailable", () => {
    expect(deriveLifecycleStatus({ ...loadedInput(), aiReachable: false })).toBe("unavailable");
  });

  it("3+ failures without a success → error", () => {
    expect(
      deriveLifecycleStatus({
        ...loadedInput(),
        consecutiveFailures: MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR,
        lastSuccessfulInferenceAt: null,
      }),
    ).toBe("error");
  });

  it("3+ failures after a past success → error (not ready)", () => {
    expect(
      deriveLifecycleStatus({
        ...loadedInput(),
        consecutiveFailures: MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR,
      }),
    ).toBe("error");
  });

  it("loaded but never ran → configured", () => {
    expect(
      deriveLifecycleStatus({ ...loadedInput(), lastSuccessfulInferenceAt: null, consecutiveFailures: 1 }),
    ).toBe("configured");
  });

  it("loaded with a successful run → ready", () => {
    expect(deriveLifecycleStatus(loadedInput())).toBe("ready");
  });
});

describe("LifecycleManager", () => {
  it("fresh state is enabled", () => {
    const manager = new LifecycleManager();
    const fresh = manager.get("vehicle");
    expect(fresh.enabled).toBe(true);
  });

  it("fresh state has no last inference", () => {
    const manager = new LifecycleManager();
    const fresh = manager.get("vehicle");
    expect(fresh.lastInferenceAt).toBe(null);
  });

  it("fresh state has unknown reachability", () => {
    const manager = new LifecycleManager();
    const fresh = manager.get("vehicle");
    expect(fresh.aiReachable).toBe(null);
  });

  it("fresh state has zero failures", () => {
    const manager = new LifecycleManager();
    const fresh = manager.get("vehicle");
    expect(fresh.consecutiveFailures).toBe(0);
  });

  it("probe is due before any probe", () => {
    const manager = new LifecycleManager();
    const key = "person";
    expect(manager.isProbeDue(key)).toBe(true);
  });

  it("success resets failure streak", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const state = manager.get(key);
    expect(state.consecutiveFailures).toBe(0);
  });

  it("success clears last error", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const state = manager.get(key);
    expect(state.lastError).toBe(null);
  });

  it("success marks AI reachable", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const state = manager.get(key);
    expect(state.aiReachable).toBe(true);
  });

  it("success records last successful inference", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const state = manager.get(key);
    expect(state.lastSuccessfulInferenceAt != null).toBe(true);
  });

  it("not in error state after success", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    expect(manager.isInErrorState(key)).toBe(false);
  });

  it("failure increments streak", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    const state = manager.get(key);
    expect(state.consecutiveFailures).toBe(1);
  });

  it("failure records error message", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    const state = manager.get(key);
    expect(state.lastError).toBe("boom");
  });

  it("failure records error time", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    const state = manager.get(key);
    expect(state.lastErrorAt != null).toBe(true);
  });

  it("probe records unreachable", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.recordReachabilityProbe(key, false);
    const state = manager.get(key);
    expect(state.aiReachable).toBe(false);
  });

  it("probe records probe time", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.recordReachabilityProbe(key, false);
    const state = manager.get(key);
    expect(state.lastProbeAt != null).toBe(true);
  });

  it("probe not due after fresh probe", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.recordReachabilityProbe(key, false);
    expect(manager.isProbeDue(key)).toBe(false);
  });

  it("probe due after TTL expires", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.recordReachabilityProbe(key, false);
    const state = manager.get(key);
    state.lastProbeAt = Date.now() - REACHABILITY_PROBE_TTL_MS - 1;
    expect(manager.isProbeDue(key)).toBe(true);
  });

  it("streak accumulates", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.markInferenceFailed(key, "again");
    manager.markInferenceFailed(key, "thrice");
    const state = manager.get(key);
    expect(state.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR);
  });

  it("in error state after 3 consecutive failures", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.markInferenceFailed(key, "again");
    manager.markInferenceFailed(key, "thrice");
    expect(manager.isInErrorState(key)).toBe(true);
  });

  it("streak keeps counting", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.markInferenceFailed(key, "again");
    manager.markInferenceFailed(key, "thrice");
    manager.markInferenceFailed(key, "fourth", true);
    const state = manager.get(key);
    expect(state.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR + 1);
  });

  it("aiUnreachable failure marks AI unreachable", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.markInferenceFailed(key, "again");
    manager.markInferenceFailed(key, "thrice");
    manager.markInferenceFailed(key, "fourth", true);
    const state = manager.get(key);
    expect(state.aiReachable).toBe(false);
  });

  it("setEnabled false persists", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.setEnabled(key, false);
    const state = manager.get(key);
    expect(state.enabled).toBe(false);
  });

  it("success does not re-enable a disabled detector", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.setEnabled(key, false);
    manager.markInferenceSucceeded(key);
    const state = manager.get(key);
    expect(state.enabled).toBe(false);
  });

  it("setEnabled true persists", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.setEnabled(key, true);
    const state = manager.get(key);
    expect(state.enabled).toBe(true);
  });

  it("re-enabling clears the failure streak", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.setEnabled(key, true);
    const state = manager.get(key);
    expect(state.consecutiveFailures).toBe(0);
  });

  it("repeated enable while enabled keeps the failure streak", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.markInferenceFailed(key, "again");
    manager.markInferenceFailed(key, "thrice");
    // Status reads mirror the DB flag on every call; they must not wipe
    // the in-progress failure streak.
    manager.setEnabled(key, true);
    manager.setEnabled(key, true);
    expect(manager.get(key).consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR);
    expect(manager.isInErrorState(key)).toBe(true);
  });

  it("disable then re-enable clears the failure streak", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.markInferenceFailed(key, "again");
    manager.markInferenceFailed(key, "thrice");
    manager.setEnabled(key, false);
    manager.setEnabled(key, true);
    expect(manager.get(key).consecutiveFailures).toBe(0);
  });

  it("snapshot includes tracked detectors", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const snapshot = manager.snapshot();
    expect(snapshot.length >= 1).toBe(true);
  });

  it("snapshot includes the person key", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const snapshot = manager.snapshot();
    expect(snapshot.some((s) => s.key === key)).toBe(true);
  });

  it("snapshot returns copies", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceSucceeded(key);
    const snapshot = manager.snapshot();
    expect(snapshot[0] !== manager.get(key)).toBe(true);
  });

  it("reset restores fresh state", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.reset(key);
    expect(manager.get(key).consecutiveFailures).toBe(0);
  });

  it("reset makes probe due again", () => {
    const manager = new LifecycleManager();
    const key = "person";
    manager.markInferenceFailed(key, "boom");
    manager.reset(key);
    expect(manager.isProbeDue(key)).toBe(true);
  });
});
