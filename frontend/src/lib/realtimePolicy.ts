/**
 * Realtime subscription hardening — pure reconnection policy.
 *
 * Bounded exponential backoff (with jitter), a hard max-attempt per
 * episode, and a small deterministic state machine so the hook can expose
 * granular connection states instead of a raw boolean. Everything here is
 * pure and unit-testable without timers or DOM.
 */

export type RealtimeConnectionState =
  | "connected"
  | "connecting"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface BackoffConfig {
  /** Base delay (ms) for the first retry. */
  baseDelayMs: number;
  /** Ceiling for a single retry delay (ms). */
  maxDelayMs: number;
  /** Multiplier applied per successive attempt. */
  factor: number;
  /** Fraction of the current delay that may be added as jitter [0,1]. */
  jitter: number;
  /** Maximum retries in a single rec-connection episode. */
  maxAttempts: number;
}

export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: 0.25,
  maxAttempts: 6,
};

/** Deterministic (seed-free) delay for a given attempt index. */
export function backoffDelayMs(attempt: number, config: BackoffConfig = DEFAULT_BACKOFF_CONFIG): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0;
  const exponent = Math.min(attempt - 1, 12);
  const exponential = config.baseDelayMs * Math.pow(config.factor, exponent);
  const bounded = Math.min(exponential, config.maxDelayMs);
  return Math.round(bounded);
}

/** Apply configurable percentage jitter around a delay (bounds: ±jitter/2). */
export function jitterDelay(delay: number, jitter: number = DEFAULT_BACKOFF_CONFIG.jitter): number {
  if (jitter <= 0 || delay <= 0) return delay;
  const spread = (Math.min(1, Math.max(0, jitter)) / 2) * delay;
  const offset = (pseudoRandom(Math.round(delay)) - 0.5) * 2 * spread;
  return Math.max(0, Math.round(delay + offset));
}

/** Deterministic PRNG (unit range) used so tests observe stable jitter. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return x - Math.floor(x);
}

export const MAX_DELAY_EXCEEDED = "max-delay-exceeded";

export interface BackoffResult {
  delayMs: number;
  attempt: number;
  /** True when the jittered delay hit the ceiling. */
  capped: boolean;
  /** True when the episode exhausted its max-attempt budget. */
  giveUp: boolean;
  reason: typeof MAX_DELAY_EXCEEDED | "success" | null;
}

/**
 * Pure backoff state machine. Returns the delay to schedule (0 means stop)
 * alongside the next attempt index. `attempt` is the index of the retry
 * being scheduled (first retry = 1).
 */
export function nextRetryAfter(
  attempt: number,
  connected: boolean,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
): BackoffResult {
  if (connected) {
    return { delayMs: 0, attempt: 0, capped: false, giveUp: false, reason: "success" };
  }
  if (attempt > config.maxAttempts) {
    return { delayMs: 0, attempt, capped: false, giveUp: true, reason: MAX_DELAY_EXCEEDED };
  }
  const base = backoffDelayMs(attempt, config);
  const capped = base >= config.maxDelayMs;
  return {
    delayMs: jitterDelay(base, config.jitter),
    attempt: attempt + 1,
    capped,
    giveUp: false,
    reason: null,
  };
}

/** How long a connection may be silent before the hook considers it dead. */
export const HEARTBEAT_TIMEOUT_MS = 45_000;

export function deriveState(params: {
  enabled: boolean;
  sourceActive: boolean;
  everConnected: boolean;
  gaveUp: boolean;
  lastError: boolean;
  retrying: boolean;
}): RealtimeConnectionState {
  if (!params.enabled) return "disconnected";
  if (params.gaveUp) return "error";
  if (params.lastError && !params.retrying) return "error";
  if (params.sourceActive && params.lastError && params.retrying) return "reconnecting";
  if (params.sourceActive && params.lastError) return "reconnecting";
  if (params.sourceActive && params.everConnected) return "connected";
  if (params.retrying || params.everConnected) return "reconnecting";
  return "connecting";
}