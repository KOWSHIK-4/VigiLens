/**
 * Webhook retry policy — pure decision helpers for bounded, deterministic
 * retries with idempotency keys.
 *
 * Retries are capped and exponentially backed off (with jitter) so a dead
 * endpoint is never hammered into a fever and events never retry forever.
 * Every attempt carries a stable `X-VigiLens-Delivery` id derived from the
 * event itself: receivers can dedupe across retries without any shared state.
 */

export type WebhookEventType = "alert" | "incident";

export interface RetryPolicyConfig {
  /** Maximum delivery attempts including the first try. */
  maxAttempts: number;
  /** Base delay for the first retry (ms). */
  baseDelayMs: number;
  /** Cap for a single retry delay (ms). */
  maxDelayMs: number;
  /** Exponential factor applied each successive attempt. */
  factor: number;
  /** Jitter spread (fraction of the computed delay). */
  jitter: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
  factor: 3,
  jitter: 0.2,
};

export const DELIVERY_HEADER_NAME = "X-VigiLens-Delivery";

/** Stable, content-addressed idempotency key: same event → same delivery id. */
export function deliveryKeyFor(eventType: WebhookEventType, eventId: string): string {
  return `wh-${eventType}-${eventId}`;
}

/** Idempotency id sent to the receiver so it can dedupe retries. */
export function deliveryIdFor(deliveryKey: string): string {
  const seed = deliveryKey;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `dlv-${(hash >>> 0).toString(16)}`;
}

/** Computes the retry delay for attempt number `attempt` (1st retry = 2). */
export function retryDelayFor(
  attempt: number,
  config: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
): number {
  if (!Number.isFinite(attempt) || attempt <= 1) return 0;
  const exponent = Math.min(attempt - 2, 12);
  const exponential = config.baseDelayMs * Math.pow(config.factor, exponent);
  return Math.min(exponential, config.maxDelayMs);
}

/** Applies bounded jitter around a delay with stable pseudo-randomness. */
export function jitterAround(
  delay: number,
  jitter: number = DEFAULT_RETRY_POLICY.jitter,
  ratio = 0.5,
): number {
  if (jitter <= 0 || delay <= 0) return delay;
  const spread = Math.min(1, Math.max(0, jitter)) * delay;
  const offset = (ratio - 0.5) * 2 * spread;
  return Math.max(0, Math.round(delay + offset));
}

export interface RetryDecision {
  retry: boolean;
  nextAttempt: number;
  nextRetryAtMs: number | null;
  reason: "delivered" | "pending_retry" | "exhausted";
}

/**
 * Decides whether a delivery attempt (`attempt` is 1-based, counting the
 * first try) warrants another try. `nowMs` is the clock at the time of the
 * decision; the returned `nextRetryAtMs` is at least `deadlineMs` in the
 * future when the receiver has a grace window.
 */
export function decideRetry(opts: {
  attempt: number;
  ok: boolean;
  nowMs: number;
  deadlineMs?: number;
  config?: RetryPolicyConfig;
}): RetryDecision {
  const config = opts.config ?? DEFAULT_RETRY_POLICY;
  if (opts.ok) {
    return { retry: false, nextAttempt: opts.attempt, nextRetryAtMs: null, reason: "delivered" };
  }
  if (opts.attempt >= config.maxAttempts) {
    return { retry: false, nextAttempt: opts.attempt, nextRetryAtMs: null, reason: "exhausted" };
  }
  const delay = retryDelayFor(opts.attempt + 1, config);
  const deadline = opts.deadlineMs ?? 0;
  const nextRetryAtMs = Math.max(opts.nowMs + delay, opts.nowMs + deadline);
  return {
    retry: true,
    nextAttempt: opts.attempt + 1,
    nextRetryAtMs,
    reason: "pending_retry",
  };
}