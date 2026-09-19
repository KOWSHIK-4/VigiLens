/**
 * Realtime subscription policy — pure tests for bounded exponential backoff,
 * retry budgets, heartbeat constants and connection-state derivation.
 *
 * The module under test is fully pure (no timers/DOM), so these run in the
 * backend vitest suite against the shared frontend policy module.
 */

import { describe, expect, it } from "vitest";
import {
  backoffDelayMs,
  DEFAULT_BACKOFF_CONFIG,
  deriveState,
  HEARTBEAT_TIMEOUT_MS,
  jitterDelay,
  MAX_DELAY_EXCEEDED,
  nextRetryAfter,
  type BackoffConfig,
} from "../frontend/src/lib/realtimePolicy";

describe("backoffDelayMs", () => {
  it("schedules the base delay for the first retry", () => {
    expect(backoffDelayMs(1)).toBe(DEFAULT_BACKOFF_CONFIG.baseDelayMs);
  });

  it("exponentially grows and bounds at the max delay", () => {
    const deltas: BackoffConfig = { ...DEFAULT_BACKOFF_CONFIG, jitter: 0, baseDelayMs: 100 };
    expect(backoffDelayMs(1, deltas)).toBe(100);
    expect(backoffDelayMs(2, deltas)).toBe(200);
    expect(backoffDelayMs(3, deltas)).toBe(400);
    expect(backoffDelayMs(20, deltas)).toBeLessThanOrEqual(deltas.maxDelayMs);
  });

  it("never exceeds the configured ceiling", () => {
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      expect(backoffDelayMs(attempt)).toBeLessThanOrEqual(
        DEFAULT_BACKOFF_CONFIG.maxDelayMs,
      );
    }
  });

  it("returns 0 for non-positive or non-finite attempts", () => {
    expect(backoffDelayMs(0)).toBe(0);
    expect(backoffDelayMs(-3)).toBe(0);
    expect(backoffDelayMs(Number.NaN)).toBe(0);
  });
});

describe("jitterDelay", () => {
  it("keeps jittered delays within the configured spread", () => {
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const base = backoffDelayMs(attempt);
      const jittered = jitterDelay(base, 0.25);
      expect(jittered).toBeGreaterThanOrEqual(Math.round(base * 0.875));
      expect(jittered).toBeLessThanOrEqual(Math.round(base * 1.125));
    }
  });

  it("returns the delay unchanged when jitter is disabled", () => {
    expect(jitterDelay(5000, 0)).toBe(5000);
  });

  it("is deterministic for identical inputs", () => {
    expect(jitterDelay(999, 0.25)).toBe(jitterDelay(999, 0.25));
  });
});

describe("nextRetryAfter", () => {
  it("short-circuits to success when already connected", () => {
    const result = nextRetryAfter(5, true);
    expect(result.reason).toBe("success");
    expect(result.delayMs).toBe(0);
    expect(result.giveUp).toBe(false);
  });

  it("gives up once the attempt budget is exhausted", () => {
    const result = nextRetryAfter(DEFAULT_BACKOFF_CONFIG.maxAttempts + 1, false);
    expect(result.giveUp).toBe(true);
    expect(result.reason).toBe(MAX_DELAY_EXCEEDED);
    expect(result.delayMs).toBe(0);
  });

  it("keeps retrying (without giving up) while inside the budget", () => {
    const result = nextRetryAfter(3, false);
    expect(result.giveUp).toBe(false);
    expect(result.delayMs).toBeGreaterThan(0);
    expect(result.attempt).toBe(4);
  });

  it("marks a capped delay without giving up", () => {
    const result = nextRetryAfter(6, false);
    expect(result.capped).toBe(true);
    expect(result.giveUp).toBe(false);
    expect(result.delayMs).toBeGreaterThan(0);
  });
});

describe("deriveState", () => {
  it("maps a healthy open stream to connected", () => {
    expect(
      deriveState({
        enabled: true,
        sourceActive: true,
        everConnected: true,
        gaveUp: false,
        lastError: false,
        retrying: false,
      }),
    ).toBe("connected");
  });

  it("maps the first attempt to connecting", () => {
    expect(
      deriveState({
        enabled: true,
        sourceActive: false,
        everConnected: false,
        gaveUp: false,
        lastError: false,
        retrying: false,
      }),
    ).toBe("connecting");
  });

  it("maps an errored stream that auto-reconnects to reconnecting", () => {
    expect(
      deriveState({
        enabled: true,
        sourceActive: true,
        everConnected: true,
        gaveUp: false,
        lastError: true,
        retrying: true,
      }),
    ).toBe("reconnecting");
  });

  it("maps a hand-up state to error", () => {
    expect(
      deriveState({
        enabled: true,
        sourceActive: false,
        everConnected: true,
        gaveUp: true,
        lastError: true,
        retrying: false,
      }),
    ).toBe("error");
  });

  it("maps a disabled subscription to disconnected", () => {
    expect(
      deriveState({
        enabled: false,
        sourceActive: false,
        everConnected: false,
        gaveUp: false,
        lastError: false,
        retrying: false,
      }),
    ).toBe("disconnected");
  });
});

describe("heartbeat", () => {
  it("defines a non-zero silence threshold", () => {
    expect(HEARTBEAT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(HEARTBEAT_TIMEOUT_MS).toBe(45_000);
  });
});