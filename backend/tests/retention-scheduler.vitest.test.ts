import { describe, it, expect, vi, beforeEach } from "vitest";
import { RetentionScheduler, RETRY_BACKOFF_MAX_MS } from "../src/services/retentionScheduler";
import type { PruneReport } from "../src/services/mediaPrune.service";
import { prisma } from "../src/config/prisma";
import { logAudit } from "../src/utils/auditLog";

const DAY_MS = 86_400_000;

interface SchedulerHarness {
  scheduler: RetentionScheduler;
  runPrune: ReturnType<typeof vi.fn<() => Promise<PruneReport>>>;
  recordRun: ReturnType<typeof vi.fn<() => Promise<void>>>;
  clock: { ms: number };
}

function fakeReport(overrides: Partial<PruneReport> = {}): PruneReport {
  return {
    dryRun: false,
    storageBasePath: "/data/vigilens",
    filesRemoved: 3,
    bytesFreed: 1024,
    detectionsRemoved: 5,
    detectionsCutoff: "2026-05-01T00:00:00.000Z",
    reportsRemoved: 1,
    reportsCutoff: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildHarness(overrides: {
  enabled?: boolean;
  intervalDays?: number;
  rejectPrune?: boolean;
} = {}): SchedulerHarness {
  const clock = { ms: 0 };
  const runPrune = vi.fn(async () => {
    if (overrides.rejectPrune) throw new Error("boom");
    return fakeReport();
  });
  const recordRun = vi.fn(async () => undefined);
  const scheduler = new RetentionScheduler({
    tickMs: 50,
    enabledReader: async () => overrides.enabled ?? true,
    intervalDaysReader: async () => overrides.intervalDays ?? 1,
    runPrune,
    recordRun,
    now: () => clock.ms,
  });
  return { scheduler, runPrune, recordRun, clock };
}

describe("RetentionScheduler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("is stopped before start and start/stop are idempotent", async () => {
    const { scheduler, runPrune } = buildHarness();
    expect(scheduler.isRunning()).toBe(false);
    scheduler.start();
    expect(scheduler.isRunning()).toBe(true);
    scheduler.start();
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    scheduler.stop();
    expect(runPrune).not.toHaveBeenCalled();
  });

  it("does not prune before the first interval elapses (primes cadence)", async () => {
    const { scheduler, runPrune, clock } = buildHarness();
    scheduler.start();
    await scheduler.runDue();
    expect(runPrune).not.toHaveBeenCalled();
    expect((await scheduler.getStatus()).nextRunAt).not.toBeNull();

    clock.ms = DAY_MS / 2;
    await scheduler.runDue();
    expect(runPrune).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it("runs exactly once after the interval elapses and records the result", async () => {
    const { scheduler, runPrune, recordRun, clock } = buildHarness();
    scheduler.start();
    await scheduler.runDue();
    clock.ms = DAY_MS;
    await scheduler.runDue();
    expect(runPrune).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(
      expect.objectContaining({ error: null, report: expect.objectContaining({ reportsRemoved: 1 }) }),
    );

    const status = await scheduler.getStatus();
    expect(status.runCount).toBe(1);
    expect(status.failCount).toBe(0);
    expect(status.lastDetectionsRemoved).toBe(5);
    expect(status.lastReportsRemoved).toBe(1);
    expect(status.lastRunAt).not.toBeNull();
    expect(status.lastError).toBeNull();
    // Next pass scheduled one full interval after the completed run.
    expect(status.nextRunAt).not.toBeNull();
    scheduler.stop();
  });

  it("respects the auto-cleanup disable switch", async () => {
    const { scheduler, runPrune, clock } = buildHarness({ enabled: false });
    scheduler.start();
    clock.ms = DAY_MS * 10;
    await scheduler.runDue();
    await scheduler.runDue();
    expect(runPrune).not.toHaveBeenCalled();
    const status = await scheduler.getStatus();
    expect(status.autoCleanupEnabled).toBe(false);
    expect(status.runCount).toBe(0);
    scheduler.stop();
  });

  it("respects a configured interval other than the default", async () => {
    const { scheduler, runPrune, clock } = buildHarness({ intervalDays: 7 });
    scheduler.start();
    await scheduler.runDue();
    // Due only after seven days.
    clock.ms = DAY_MS * 6;
    await scheduler.runDue();
    expect(runPrune).not.toHaveBeenCalled();
    clock.ms = DAY_MS * 7;
    await scheduler.runDue();
    expect(runPrune).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("records failures, keeps ticking, and retries sooner than the interval", async () => {
    const { scheduler, runPrune, recordRun, clock } = buildHarness({ rejectPrune: true });
    scheduler.start();
    await scheduler.runDue();
    clock.ms = DAY_MS;
    await scheduler.runDue();

    expect(runPrune).toHaveBeenCalledTimes(1);
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ error: "boom", report: null }));
    const status = await scheduler.getStatus();
    expect(status.failCount).toBe(1);
    expect(status.runCount).toBe(0);
    expect(status.lastError).toBe("boom");

    // Failure schedules a retry far sooner than a full interval.
    if (status.nextRunAt) {
      const retryIn = new Date(status.nextRunAt).getTime() - clock.ms;
      expect(retryIn).toBeLessThanOrEqual(RETRY_BACKOFF_MAX_MS);
      expect(retryIn).toBeLessThan(DAY_MS);
    } else {
      throw new Error("expected a retry nextRunAt after failure");
    }

    // The retry succeeds once the runner recovers.
    runPrune.mockResolvedValueOnce(fakeReport());
    clock.ms += RETRY_BACKOFF_MAX_MS;
    await scheduler.runDue();
    expect(runPrune).toHaveBeenCalledTimes(2);
    expect((await scheduler.getStatus()).runCount).toBe(1);
    scheduler.stop();
  });

  it("recovers after a transient failure without throwing", async () => {
    const clock = { ms: 0 };
    const runPrune = vi
      .fn<() => Promise<PruneReport>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(fakeReport());
    const recordRun = vi.fn(async () => undefined);
    const scheduler = new RetentionScheduler({
      tickMs: 50,
      enabledReader: async () => true,
      intervalDaysReader: async () => 1,
      runPrune,
      recordRun,
      now: () => clock.ms,
    });
    scheduler.start();
    await scheduler.runDue();
    clock.ms = DAY_MS;
    await expect(scheduler.runDue()).resolves.toBeUndefined();
    clock.ms = DAY_MS + RETRY_BACKOFF_MAX_MS;
    await scheduler.runDue();
    expect(runPrune).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});

describe("retention_pruned audit integration", () => {
  it("accepts the retention_pruned action end-to-end through the audit store", async () => {
    await prisma.auditLog.deleteMany({ where: { action: "retention_pruned" } });
    await logAudit({
      username: "system",
      action: "retention_pruned",
      module: "retention",
      description: "Automated data retention prune completed",
      metadata: { filesRemoved: 3, bytesFreed: 1024, detectionsRemoved: 5, reportsRemoved: 1 },
    });
    const rows = await prisma.auditLog.findMany({ where: { action: "retention_pruned" } });
    expect(rows.length).toBe(1);
    const meta = rows[0].metadata as { filesRemoved?: number; reportsRemoved?: number };
    expect(meta.filesRemoved).toBe(3);
    expect(meta.reportsRemoved).toBe(1);
    await prisma.auditLog.deleteMany({ where: { action: "retention_pruned" } });
  });
});