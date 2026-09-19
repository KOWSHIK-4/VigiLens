/**
 * Webhook retry policy — pure unit tests.
 *
 * No HTTP, no timers, no database: the policy, idempotency keys, queue and
 * scheduler decision are verified with injected clocks and deliver fakes.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_POLICY,
  deliveryIdFor,
  deliveryKeyFor,
  decideRetry,
  jitterAround,
  retryDelayFor,
} from "../src/services/webhookRetryPolicy";
import { WebhookRetryQueue } from "../src/services/webhookRetryQueue";
import { WebhookRetryScheduler } from "../src/services/webhookRetryScheduler";

describe("deliveryKeyFor / deliveryIdFor", () => {
  it("derives stable idempotency keys from the event", () => {
    expect(deliveryKeyFor("alert", "evt-1")).toContain("evt-1");
    expect(deliveryKeyFor("alert", "evt-1")).toBe(deliveryKeyFor("alert", "evt-1"));
    expect(deliveryKeyFor("alert", "evt-1")).not.toBe(deliveryKeyFor("incident", "evt-1"));
  });

  it("produces a deterministic, non-empty delivery id", () => {
    const key = deliveryKeyFor("alert", "evt-1");
    const id = deliveryIdFor(key);
    expect(id).toMatch(/^dlv-[0-9a-f]+$/);
    expect(deliveryIdFor(key)).toBe(id);
  });
});

describe("retryDelayFor", () => {
  it("returns 0 before the first retry attempt", () => {
    expect(retryDelayFor(0)).toBe(0);
    expect(retryDelayFor(1)).toBe(0);
  });

  it("scales exponentially and caps at the ceiling", () => {
    expect(retryDelayFor(2)).toBe(DEFAULT_RETRY_POLICY.baseDelayMs);
    expect(retryDelayFor(3)).toBe(DEFAULT_RETRY_POLICY.baseDelayMs * 3);
    expect(retryDelayFor(20)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });
});

describe("jitterAround", () => {
  it("stays within the configured spread and is deterministic", () => {
    const jittered = jitterAround(1000, 0.2, 0.3);
    expect(jittered).toBeGreaterThanOrEqual(800);
    expect(jittered).toBeLessThanOrEqual(1200);
    expect(jitterAround(1000, 0.2, 0.3)).toBe(jittered);
    expect(jitterAround(1000, 0, 0.3)).toBe(1000);
  });
});

describe("decideRetry", () => {
  it("stops on success", () => {
    const decision = decideRetry({ attempt: 1, ok: true, nowMs: 1000 });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toBe("delivered");
  });

  it("schedules the next attempt on failure", () => {
    const decision = decideRetry({ attempt: 1, ok: false, nowMs: 1000 });
    expect(decision.retry).toBe(true);
    expect(decision.reason).toBe("pending_retry");
    expect(decision.nextAttempt).toBe(2);
    expect(decision.nextRetryAtMs).toBeGreaterThan(1000);
  });

  it("exhausts at the attempt cap", () => {
    const decision = decideRetry({
      attempt: DEFAULT_RETRY_POLICY.maxAttempts,
      ok: false,
      nowMs: 1000,
    });
    expect(decision.retry).toBe(false);
    expect(decision.reason).toBe("exhausted");
  });
});

function successDeliver() {
  return Promise.resolve({ ok: true });
}

function failDeliver(error?: string) {
  return Promise.resolve({ ok: false, error: error ?? "boom" });
}

describe("WebhookRetryQueue", () => {
  it("delivers immediately when due and prunes on success", async () => {
    const queue = new WebhookRetryQueue(successDeliver);
    queue.enqueue("alert", "evt-1", { id: "evt-1" });
    const result = await queue.processDue(0);
    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(queue.pendingCount).toBe(0);
  });

  it("retries failed deliveries and stops at the cap, burying dead letters", async () => {
    const queue = new WebhookRetryQueue(failDeliver, { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 });
    queue.enqueue("alert", "evt-1", { id: "evt-1" });

    const first = await queue.processDue(0);
    expect(first.failed).toBe(1);
    expect(queue.pendingCount).toBe(1);

    const second = await queue.processDue(100_000);
    expect(second.failed).toBe(1);
    expect(queue.pendingCount).toBe(1);

    const third = await queue.processDue(10_000_000);
    expect(third.failed).toBe(1);
    expect(queue.pendingCount).toBe(0);
    expect(queue.deadLetterCount).toBe(1);
  });

  it("is idempotent when the same event is enqueued twice", async () => {
    const queue = new WebhookRetryQueue(successDeliver);
    queue.enqueue("alert", "evt-1", { id: "evt-1" });
    queue.enqueue("alert", "evt-1", { id: "evt-1" });
    expect(queue.pendingCount).toBe(1);
  });

  it("does not overlap processing while a run is in flight", async () => {
    let resolveRun: (() => void) | null = null;
    const queue = new WebhookRetryQueue(
      () =>
        new Promise((resolve) => {
          resolveRun = () => resolve({ ok: true });
        }),
    );
    queue.enqueue("alert", "evt-1", { id: "evt-1" });
    const first = queue.processDue(0);
    const second = await queue.processDue(0);
    expect(second.attempted).toBe(0);
    resolveRun?.();
    await first;
  });

  it("preserves the attempt number and payload across retries", async () => {
    const attempts: number[] = [];
    const queue = new WebhookRetryQueue(async (_type, _id, payload, attempt) => {
      attempts.push(attempt);
      return attempt >= 3 ? { ok: true } : { ok: false, error: "nope" };
    }, { ...DEFAULT_RETRY_POLICY, maxAttempts: 5 });

    queue.enqueue("incident", "evt-2", { id: "evt-2", name: "payload" });
    await queue.processDue(0);
    await queue.processDue(100_000);
    const final = await queue.processDue(10_000_000);
    expect(attempts).toEqual([1, 2, 3]);
    expect(final.succeeded).toBe(1);
    expect(queue.pendingCount).toBe(0);
  });
});

describe("WebhookRetryScheduler", () => {
  it("runs a pass with the injected deliver and exposes status", async () => {
    const queue = new WebhookRetryQueue(failDeliver);
    const scheduler = new WebhookRetryScheduler({ tickMs: 1000, now: () => 500 }, queue);
    scheduler.deliver = async () => ({ ok: true });
    queue.enqueue("alert", "evt-1", { id: "evt-1" });
    await scheduler.runOnce();
    expect(scheduler.getStatus().lastRunResult).toEqual({
      attempted: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(queue.pendingCount).toBe(0);
  });

  it("buries dead letters in the schedule status", async () => {
    const queue = new WebhookRetryQueue(failDeliver, { ...DEFAULT_RETRY_POLICY, maxAttempts: 2 });
    const scheduler = new WebhookRetryScheduler({ now: () => 0 }, queue);
    queue.enqueue("incident", "evt-2", { id: "evt-2" });
    await scheduler.runOnce();
    await scheduler.runOnce(10_000_000);
    expect(scheduler.getStatus().deadLetters).toBe(1);
  });
});