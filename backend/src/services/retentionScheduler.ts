/**
 * In-process Retention Scheduler.
 *
 * Runs the data retention job (`pruneMedia`) automatically on the cadence
 * configured by the `cleanup_interval_days` storage setting, gated by the
 * `auto_cleanup_enabled` detection setting. Every completed (or failed) pass
 * is written to the audit trail as `retention_pruned`.
 *
 * The scheduler is deliberately conservative:
 *   - the first pass is scheduled one full cleanup interval after start
 *     (no immediate deletion on boot; operators can run `npm run prune:media`
 *     at any time for an on-demand pass);
 *   - a failed pass is retried sooner (up to an hour) instead of waiting a
 *     full interval;
 *   - runs never overlap — a stuck pass cannot pile up ticks;
 *   - per-run state (last result, error, counts) is exposed via `getStatus`
 *     so the system monitoring API can surface current retention state.
 *
 * Dependencies (settings readers, prune runner, audit writer, clock) are
 * injected so the scheduler can be unit-tested without a database, a real
 * filesystem or the AI service.
 */

import { logger } from "../config/logger";
import { logAudit } from "../utils/auditLog";
import { settingsService } from "./settings.service";
import { pruneMedia, type PruneReport } from "./mediaPrune.service";

const AUTO_CLEANUP_KEY = "auto_cleanup_enabled";
const CLEANUP_INTERVAL_KEY = "cleanup_interval_days";

/** Fallback when settings are unavailable or misconfigured. */
export const DEFAULT_CLEANUP_INTERVAL_DAYS = 1;
/** Failures are retried within an hour at most rather than a full interval. */
export const RETRY_BACKOFF_MAX_MS = 3_600_000;

export interface RetentionRunOutcome {
  report: PruneReport | null;
  error: string | null;
}

export interface RetentionSchedulerOptions {
  /** Poll cadence; only checks whether a pass is due each tick. */
  tickMs?: number;
  /** Reads the auto-cleanup switch. Default: the `ai_detection` setting. */
  enabledReader?: () => Promise<boolean>;
  /** Reads the cleanup interval in days. Default: the `storage` setting. */
  intervalDaysReader?: () => Promise<number>;
  /** Runs one retention pass. Default: `pruneMedia` against configured settings. */
  runPrune?: () => Promise<PruneReport>;
  /** Records the outcome of a pass (audit trail). Default: audit log writer. */
  recordRun?: (outcome: RetentionRunOutcome) => Promise<void>;
  /** Injectable clock. */
  now?: () => number;
}

export interface RetentionStatus {
  running: boolean;
  autoCleanupEnabled: boolean;
  intervalDays: number;
  startedAt: string | null;
  stoppedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  failCount: number;
  lastFilesRemoved: number | null;
  lastBytesFreed: number | null;
  lastDetectionsRemoved: number | null;
  lastReportsRemoved: number | null;
  lastError: string | null;
  lastRunDurationMs: number | null;
}

async function defaultEnabledReader(): Promise<boolean> {
  const value = await settingsService.getValue("ai_detection", AUTO_CLEANUP_KEY);
  return value === true;
}

async function defaultIntervalDaysReader(): Promise<number> {
  const value = await settingsService.getValue("storage", CLEANUP_INTERVAL_KEY);
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) return value;
  return DEFAULT_CLEANUP_INTERVAL_DAYS;
}

async function defaultRecordRun(outcome: RetentionRunOutcome): Promise<void> {
  if (outcome.error) {
    await logAudit({
      username: "system",
      action: "retention_pruned",
      module: "retention",
      description: "Automated data retention prune failed",
      status: "failed",
      metadata: { error: outcome.error },
    });
    return;
  }
  const report = outcome.report;
  if (!report) return;
  await logAudit({
    username: "system",
    action: "retention_pruned",
    module: "retention",
    description: "Automated data retention prune completed",
    metadata: {
      dryRun: report.dryRun,
      filesRemoved: report.filesRemoved,
      bytesFreed: report.bytesFreed,
      detectionsRemoved: report.detectionsRemoved,
      reportsRemoved: report.reportsRemoved,
    },
  });
}

export class RetentionScheduler {
  private readonly tickMs: number;
  private readonly enabledReader: () => Promise<boolean>;
  private readonly intervalDaysReader: () => Promise<number>;
  private readonly runPrune: () => Promise<PruneReport>;
  private readonly recordRun: (outcome: RetentionRunOutcome) => Promise<void>;
  private readonly now: () => number;

  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private startedAt: Date | null = null;
  private stoppedAt: Date | null = null;
  private nextRunAt: Date | null = null;
  private lastRunAt: Date | null = null;
  private primed = false;
  private runCount = 0;
  private failCount = 0;
  private lastReport: PruneReport | null = null;
  private lastError: string | null = null;
  private lastRunDurationMs: number | null = null;
  private runInFlight = false;

  constructor(options: RetentionSchedulerOptions = {}) {
    this.tickMs = options.tickMs ?? 60_000;
    this.enabledReader = options.enabledReader ?? defaultEnabledReader;
    this.intervalDaysReader = options.intervalDaysReader ?? defaultIntervalDaysReader;
    this.runPrune = options.runPrune ?? (() => pruneMedia());
    this.recordRun = options.recordRun ?? defaultRecordRun;
    this.now = options.now ?? (() => Date.now());
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date(this.now());
    this.stoppedAt = null;
    this.nextRunAt = null;
    this.lastRunAt = null;
    this.primed = false;
    this.lastReport = null;
    this.lastError = null;
    this.runCount = 0;
    this.failCount = 0;
    this.lastRunDurationMs = null;
    this.runInFlight = false;
    this.timer = setInterval(() => {
      void this.runDue();
    }, this.tickMs);
    if (this.timer.unref) this.timer.unref();
    logger.info("Retention scheduler started", { tickMs: this.tickMs });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stoppedAt = new Date(this.now());
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Retention scheduler stopped");
  }

  async getStatus(): Promise<RetentionStatus> {
    const [autoCleanupEnabled, intervalDays] = await Promise.all([
      this.enabledReader().catch(() => false),
      this.intervalDaysReader().catch(() => DEFAULT_CLEANUP_INTERVAL_DAYS),
    ]);
    const interval = intervalDays >= 1 ? Math.round(intervalDays) : DEFAULT_CLEANUP_INTERVAL_DAYS;
    return {
      running: this.running,
      autoCleanupEnabled,
      intervalDays: interval,
      startedAt: this.startedAt?.toISOString() ?? null,
      stoppedAt: this.stoppedAt?.toISOString() ?? null,
      lastRunAt: this.lastRunAt?.toISOString() ?? null,
      nextRunAt: this.nextRunAt?.toISOString() ?? null,
      runCount: this.runCount,
      failCount: this.failCount,
      lastFilesRemoved: this.lastReport?.filesRemoved ?? null,
      lastBytesFreed: this.lastReport?.bytesFreed ?? null,
      lastDetectionsRemoved: this.lastReport?.detectionsRemoved ?? null,
      lastReportsRemoved: this.lastReport?.reportsRemoved ?? null,
      lastError: this.lastError,
      lastRunDurationMs: this.lastRunDurationMs,
    };
  }

  /**
   * One scheduling pass: run a retention prune when the configured interval
   * has elapsed and auto-cleanup is enabled. Exposed publicly so callers and
   * unit tests can drive the scheduler deterministically.
   */
  async runDue(): Promise<void> {
    if (!this.running || this.runInFlight) return;
    const now = this.now();
    if (this.nextRunAt && now < this.nextRunAt.getTime()) return;

    const enabled = await this.enabledReader().catch(() => false);
    if (!enabled) return;
    const intervalDays = await this.intervalDaysReader().catch(() => DEFAULT_CLEANUP_INTERVAL_DAYS);
    if (!(intervalDays >= 1)) return;
    const intervalMs = intervalDays * 86_400_000;

    // First-ever pass: prime the cadence instead of pruning immediately.
    if (!this.primed) {
      this.nextRunAt = new Date(now + intervalMs);
      this.lastRunDurationMs = 0;
      this.primed = true;
      return;
    }

    this.runInFlight = true;
    const started = process.hrtime.bigint();
    try {
      const report = await this.runPrune();
      this.lastRunAt = new Date(this.now());
      this.lastReport = report;
      this.lastError = null;
      this.runCount += 1;
      this.lastRunDurationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      this.nextRunAt = new Date(this.lastRunAt.getTime() + intervalMs);
      await this.recordRun({ report, error: null }).catch((err) => {
        logger.error("Retention audit write failed", { error: err });
      });
      logger.info("Retention prune completed", {
        filesRemoved: report.filesRemoved,
        bytesFreed: report.bytesFreed,
        detectionsRemoved: report.detectionsRemoved,
        reportsRemoved: report.reportsRemoved,
        durationMs: this.lastRunDurationMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.failCount += 1;
      this.lastError = message;
      this.lastRunDurationMs = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
      // Retry sooner than the full interval after a failure.
      this.nextRunAt = new Date(now + Math.min(intervalMs, RETRY_BACKOFF_MAX_MS));
      await this.recordRun({ report: null, error: message }).catch((recordErr) => {
        logger.error("Retention audit write failed", { error: recordErr });
      });
      logger.warn("Retention prune failed", {
        error: message,
        failCount: this.failCount,
        nextRunAt: this.nextRunAt.toISOString(),
      });
    } finally {
      this.runInFlight = false;
    }
  }
}

export const retentionScheduler = new RetentionScheduler();