import { logger } from "../config/logger";
import {
  decideRetry,
  deliveryIdFor,
  deliveryKeyFor,
  DEFAULT_RETRY_POLICY,
  jitterAround,
  retryDelayFor,
  type RetryPolicyConfig,
  type WebhookEventType,
} from "./webhookRetryPolicy";

export interface WebhookQueueEntry {
  id: string;
  eventType: WebhookEventType;
  eventId: string;
  payload: Record<string, unknown>;
  attempt: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export type WebhookDeliver =
  (eventType: WebhookEventType, eventId: string, payload: Record<string, unknown>, attempt: number) =>
    Promise<{ ok: boolean; error?: string | null }>;

/**
 * In-memory bounded retry queue for webhook deliveries. Failed deliveries are
 * retried with bounded exponential backoff; an entry that exhausts its
 * attempts is surfaced via `getDeadLetters` so operators can inspect events
 * that were never accepted.
 *
 * The queue is deliberately process-local — it is rebuilt from the event
 * stream rather than persisting (see phase docs for the trade-off). It never
 * overlaps runs: `processDue` awaits a full pass.
 */
export class WebhookRetryQueue {
  private pending: WebhookQueueEntry[] = [];
  private deadLetters: WebhookQueueEntry[] = [];
  private deliver: WebhookDeliver;
  private readonly defaultDeliver: WebhookDeliver;
  private readonly config: RetryPolicyConfig;
  private running = false;

  constructor(deliver: WebhookDeliver, config: RetryPolicyConfig = DEFAULT_RETRY_POLICY) {
    this.defaultDeliver = deliver;
    this.deliver = deliver;
    this.config = config;
  }

  /** Swaps the active delivery implementation (e.g. wiring the real HTTP client). */
  configureDeliver(deliver: WebhookDeliver): void {
    this.deliver = deliver;
  }

  /** Alias kept for wiring ergonomics (same as configureDeliver). */
  setDeliver(deliver: WebhookDeliver): void {
    this.deliver = deliver;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get deadLetterCount(): number {
    return this.deadLetters.length;
  }

  /** Queues the first delivery attempt of an event. Idempotent per event. */
  enqueue(eventType: WebhookEventType, eventId: string, payload: Record<string, unknown>): void {
    const id = deliveryKeyFor(eventType, eventId);
    if (this.pending.some((entry) => entry.id === id)) return;
    this.pending.push({
      id,
      eventType,
      eventId,
      payload: { ...payload },
      attempt: 1,
      nextAttemptAt: 0,
      lastError: null,
    });
  }

  /** Attempts every pending delivery whose next attempt is due. */
  async processDue(nowMs: number, deadlineMs = 0): Promise<{ attempted: number; succeeded: number; failed: number }> {
    if (this.running) return { attempted: 0, succeeded: 0, failed: 0 };
    this.running = true;
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    try {
      const due = this.pending.filter((entry) => entry.nextAttemptAt <= nowMs);
      for (const entry of due) {
        attempted += 1;
        try {
          const result = await this.deliver(
            entry.eventType,
            entry.eventId,
            entry.payload,
            entry.attempt,
          );
          if (result.ok) {
            succeeded += 1;
            this.pending = this.pending.filter((e) => e.id !== entry.id);
            continue;
          }
          failed += 1;
          entry.lastError = result.error ?? "webhook delivery failed";
          const decision = decideRetry({
            attempt: entry.attempt,
            ok: false,
            nowMs,
            deadlineMs,
            config: this.config,
          });
          if (decision.retry && decision.nextRetryAtMs !== null) {
            // Apply jitter around the policy delay so retries spread out.
            const rawDelay = retryDelayFor(entry.attempt + 1, this.config);
            const jitteredDelay =
              rawDelay > 0 ? jitterAround(rawDelay, this.config.jitter, Math.random()) : rawDelay;
            entry.nextAttemptAt = nowMs + jitteredDelay;
            entry.attempt = decision.nextAttempt;
          } else {
            entry.lastError = "retries exhausted";
            this.deadLetters.push(entry);
            this.pending = this.pending.filter((e) => e.id !== entry.id);
          }
        } catch (err) {
          failed += 1;
          entry.lastError = err instanceof Error ? err.message : String(err);
        }
      }
    } finally {
      this.running = false;
    }
    return { attempted, succeeded, failed };
  }

  getPendingSnapshot(): WebhookQueueEntry[] {
    return this.pending.map((entry) => ({ ...entry, payload: { ...entry.payload } }));
  }

  getDeadLettersSnapshot(): WebhookQueueEntry[] {
    return this.deadLetters.map((entry) => ({ ...entry, payload: { ...entry.payload } }));
  }

  clear(): void {
    this.pending = [];
    this.deadLetters = [];
  }
}

export const webhookRetryQueue = new WebhookRetryQueue(async (eventType, eventId, payload, attempt) => {
  // The real delivery is owned by the webhook service; this default is a
  // no-op that never retries. index.ts wires a concrete delivery function.
  void eventType;
  void eventId;
  void payload;
  void attempt;
  logger.warn("webhookRetryQueue default deliver invoked without wiring");
  return { ok: false, error: "not wired" };
});

/** Convenience accessor used by the scheduler/config wiring. */
export function deliveryIdForEvent(eventType: WebhookEventType, eventId: string): string {
  return deliveryIdFor(deliveryKeyFor(eventType, eventId));
}