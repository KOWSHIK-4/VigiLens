/**
 * Detector Engine v2 — Detector Lifecycle.
 *
 * Tracks the runtime lifecycle of every installed detector across pipeline
 * runs: when it last inferred, when it last failed, whether the AI backend
 * is reachable, and how many consecutive failures have occurred. The
 * `LifecycleManager` is a per-process, in-memory store shared by the
 * engine service and the runtime registry. It is deliberately lightweight:
 * durable facts (enabled flag, model status) come from the database, while
 * this module adds the *measured* engine facts that the database cannot
 * know (last successful inference, consecutive failures, reachability).
 */

import type { DetectorAvailability, DetectorRuntimeStatus } from "./types";

export interface DetectorLifecycleState {
  key: string;
  enabled: boolean;
  /** Last engine run attempt (success or failure). */
  lastInferenceAt: string | null;
  /** Last engine run that produced a persisted detection or a clean result. */
  lastSuccessfulInferenceAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  consecutiveFailures: number;
  /** null = unknown (no probe/run yet), true/false from the last probe. */
  aiReachable: boolean | null;
  /** Unix ms of the last reachability probe, for TTL-based caching. */
  lastProbeAt: number | null;
}

export interface LifecycleDerivationInput {
  installed: boolean;
  enabled: boolean;
  availability: DetectorAvailability;
  modelStatus: string | null;
  aiReachable: boolean | null;
  consecutiveFailures: number;
  lastSuccessfulInferenceAt: string | null;
}

/**
 * Derives the 9-state lifecycle status from durable (DB) and measured
 * (engine) facts. Pure and deterministic — unit tested directly.
 */
export function deriveLifecycleStatus(input: LifecycleDerivationInput): DetectorRuntimeStatus {
  if (!input.installed || input.availability === "unconfigured") {
    return "unconfigured";
  }
  if (!input.enabled) {
    return "disabled";
  }
  if (input.modelStatus === "disabled") {
    return "enabled";
  }
  if (input.modelStatus === "loading") {
    return "loading";
  }
  if (input.modelStatus === "error") {
    return "error";
  }
  if (input.modelStatus !== "loaded") {
    return "registered";
  }
  if (input.aiReachable === false) {
    return "unavailable";
  }
  if (input.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR) {
    return "error";
  }
  if (!input.lastSuccessfulInferenceAt) {
    return "configured";
  }
  return "ready";
}

const MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR = 3;
const REACHABILITY_PROBE_TTL_MS = 15_000;

function freshState(key: string): DetectorLifecycleState {
  return {
    key,
    enabled: true,
    lastInferenceAt: null,
    lastSuccessfulInferenceAt: null,
    lastError: null,
    lastErrorAt: null,
    consecutiveFailures: 0,
    aiReachable: null,
    lastProbeAt: null,
  };
}

export class LifecycleManager {
  private readonly states = new Map<string, DetectorLifecycleState>();

  get(key: string): DetectorLifecycleState {
    let state = this.states.get(key);
    if (!state) {
      state = freshState(key);
      this.states.set(key, state);
    }
    return state;
  }

  setEnabled(key: string, enabled: boolean): void {
    const state = this.get(key);
    const wasEnabled = state.enabled;
    state.enabled = enabled;
    if (enabled && !wasEnabled) {
      // Re-enabling clears the failure streak so a healthy run can recover.
      // Only the disabled→enabled transition may do this: setEnabled is also
      // called on every status read to mirror the DB flag, and resetting the
      // streak there would erase in-progress failure evidence.
      state.consecutiveFailures = 0;
    }
    this.states.set(key, state);
  }

  markInferenceSucceeded(key: string): void {
    const state = this.get(key);
    const now = new Date().toISOString();
    state.lastInferenceAt = now;
    state.lastSuccessfulInferenceAt = now;
    state.lastError = null;
    state.lastErrorAt = null;
    state.consecutiveFailures = 0;
    state.aiReachable = true;
    this.states.set(key, state);
  }

  markInferenceFailed(key: string, error: string, aiUnreachable = false): void {
    const state = this.get(key);
    const now = new Date().toISOString();
    state.lastInferenceAt = now;
    state.lastError = error;
    state.lastErrorAt = now;
    state.consecutiveFailures += 1;
    if (aiUnreachable) {
      state.aiReachable = false;
    }
    this.states.set(key, state);
  }

  recordReachabilityProbe(key: string, reachable: boolean): void {
    const state = this.get(key);
    state.aiReachable = reachable;
    state.lastProbeAt = Date.now();
    this.states.set(key, state);
  }

  isProbeDue(key: string): boolean {
    const state = this.get(key);
    if (state.aiReachable === null) return true;
    const last = state.lastProbeAt ?? 0;
    return Date.now() - last >= REACHABILITY_PROBE_TTL_MS;
  }

  consecutiveFailures(key: string): number {
    return this.get(key).consecutiveFailures;
  }

  isInErrorState(key: string): boolean {
    const state = this.get(key);
    return state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR;
  }

  snapshot(): DetectorLifecycleState[] {
    return [...this.states.values()].map((s) => ({ ...s }));
  }

  reset(key: string): void {
    this.states.delete(key);
  }
}

export const lifecycleManager = new LifecycleManager();

export { MAX_CONSECUTIVE_FAILURES_BEFORE_ERROR, REACHABILITY_PROBE_TTL_MS };
