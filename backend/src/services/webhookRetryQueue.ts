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
 * Ceilings for the two in-memory buffers. Both are hard caps: the queue holds
 * full alert payloads, so without them a tenant whose receiver never accepts a
 * delivery grows this process's heap without limit.
 */
export const DEFAULT_MAX_PENDING = 1_000;
export const DEFAULT_MAX_DEAD_LETTERS = 500;

export interface WebhookRetryQueueLimits {
  maxPending: number;
  maxDeadLetters: number;
}

const DEFAULT_LIMITS: WebhookRetryQueueLimits = {
  maxPending: DEFAULT_MAX_PENDING,
  maxDeadLetters: DEFAULT_MAX_DEAD_LETTERS,
};

/**
 * In-memory bounded retry queue for webhook deliveries. Failed deliveries are
 * retried with bounded exponential backoff; an entry that exhausts its
 * attempts is surfaced via `getDeadLetters` so operators can inspect events
 * that were never accepted.
 *
 * The queue is deliberately process-local — it is rebuilt from the event
 * stream rather than persisting (see phase docs for the trade-off). It never
 * overlaps runs: `processDue` awaits a full pass.
 *
 * Bounding is enforced on both buffers. `enqueue` sheds the oldest pending
 * entry once `maxPending` is reached, and a dead letter is dropped the same way
 * once `maxDeadLetters` is reached. Overflow is the right behaviour here: the
 * alternative is an OOM, and a retry that has not been attempted yet is worth
 * less than one already in flight. Every drop is logged, so a tenant whose
 * receiver is black-holing can be told their alerts are being discarded
 * instead of silently vanishing.
 */
export class WebhookRetryQueue {
  private pending: WebhookQueueEntry[] = [];
  private deadLetters: WebhookQueueEntry[] = [];
  /** Ids currently in `pending`, so the enqueue dedupe check is not O(n). */
  private pendingIds = new Set<string>();
  private deliver: WebhookDeliver;
  private readonly defaultDeliver: WebhookDeliver;
  private readonly config: RetryPolicyConfig;
  private readonly limits: WebhookRetryQueueLimits;
  private running = false;

  constructor(
    deliver: WebhookDeliver,
    config: RetryPolicyConfig = DEFAULT_RETRY_POLICY,
    limits: Partial<WebhookRetryQueueLimits> = {},
  ) {
    this.defaultDeliver = deliver;
    this.deliver = deliver;
    this.config = config;
    this.limits = { ...DEFAULT_LIMITS, ...limits };
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
    if (this.pendingIds.has(id)) return;
    if (this.pending.length >= this.limits.maxPending) {
      const shed = this.pending.shift();
      if (shed) {
        this.pendingIds.delete(shed.id);
        logger.warn("Webhook retry queue full, dropped oldest pending delivery", {
          droppedDeliveryId: shed.id,
          maxPending: this.limits.maxPending,
        });
      }
    }
    this.pending.push({
      id,
      eventType,
      eventId,
      payload: { ...payload },
      attempt: 1,
      nextAttemptAt: 0,
      lastError: null,
    });
    this.pendingIds.add(id);
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
            this.removePending(entry.id);
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
            this.removePending(entry.id);
            if (this.deadLetters.length >= this.limits.maxDeadLetters) {
              const dropped = this.deadLetters.shift();
              logger.warn("Webhook dead-letter buffer full, dropped oldest entry", {
                droppedDeliveryId: dropped?.id,
                maxDeadLetters: this.limits.maxDeadLetters,
              });
            }
            this.deadLetters.push(entry);
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
    this.pendingIds.clear();
  }

  /** Drops a delivery from `pending` and keeps the id index in step. */
  private removePending(id: string): void {
    this.pendingIds.delete(id);
    this.pending = this.pending.filter((e) => e.id !== id);
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