/**
 * In-process Webhook Retry Scheduler.
 *
 * Polls the bounded in-memory retry queue every tick and replays deliveries
 * that are due. It is intentionally conservative: a single pass never
 * overlaps the previous one (a stuck/long delivery cannot pile up ticks),
 * and every dispatch is bounded by the policy's attempt cap.
 *
 * The actual HTTP delivery is injected so the scheduler can be exercised
 * without a real endpoint or a database.
 */

import { logger } from "../config/logger";
import { webhookRetryQueue, type WebhookRetryQueue } from "./webhookRetryQueue";
import type { WebhookEventType } from "./webhookRetryPolicy";

export interface WebhookRetrySchedulerOptions {
  tickMs?: number;
  deliver?: WebhookRetrySchedulerOptionsDeliver;
  now?: () => number;
}

export type WebhookRetrySchedulerOptionsDeliver = (
  eventType: WebhookEventType,
  eventId: string,
  payload: Record<string, unknown>,
  attempt: number,
) => Promise<{ ok: boolean; error?: string | null }>;

export interface WebhookRetrySchedulerStatus {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  pending: number;
  deadLetters: number;
  lastRunAt: string | null;
  lastRunResult: { attempted: number; succeeded: number; failed: number } | null;
}

export const WEBHOOK_RETRY_TICK_MS = 60_000;

export class WebhookRetryScheduler {
  private readonly tickMs: number;
  private readonly queue: WebhookRetryQueue;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startedAt: string | null = null;
  private stoppedAt: string | null = null;
  private lastRunAt: string | null = null;
  private lastRunResult: WebhookRetrySchedulerStatus["lastRunResult"] = null;

  constructor(options: WebhookRetrySchedulerOptions = {}, queue?: WebhookRetryQueue) {
    this.tickMs = options.tickMs ?? WEBHOOK_RETRY_TICK_MS;
    this.queue = queue ?? webhookRetryQueue;
    this.now = options.now ?? (() => Date.now());
    if (options.deliver) this.queue.setDeliver(options.deliver);
  }

  /** Delivery implementation. Set before `start()` (see index.ts wiring). */
  deliver: WebhookRetrySchedulerOptionsDeliver = async () => ({
    ok: false,
    error: "no deliver wired",
  });

  start(): void {
    if (this.timer) return;
    this.startedAt = new Date().toISOString();
    this.stoppedAt = null;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    logger.info("Webhook retry scheduler started", { tickMs: this.tickMs });
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.stoppedAt = new Date().toISOString();
    logger.info("Webhook retry scheduler stopped");
  }

  async runOnce(nowMs = this.now()): Promise<void> {
    try {
      this.lastRunAt = new Date(nowMs).toISOString();
      this.queue.configureDeliver(
        async (eventType, eventId, payload, attempt) =>
          this.deliver(eventType, eventId, payload, attempt),
      );
      this.lastRunResult = await this.queue.processDue(nowMs);
    } catch (err) {
      logger.error("Webhook retry pass failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      this.lastRunResult = { attempted: 0, succeeded: 0, failed: 0 };
    }
  }

  async drain(): Promise<void> {
    await this.runOnce();
  }

  getStatus(): WebhookRetrySchedulerStatus {
    return {
      running: this.timer !== null,
      startedAt: this.startedAt,
      stoppedAt: this.stoppedAt,
      pending: this.queue.pendingCount,
      deadLetters: this.queue.deadLetterCount,
      lastRunAt: this.lastRunAt,
      lastRunResult: this.lastRunResult,
    };
  }
}

export const webhookRetryScheduler = new WebhookRetryScheduler();