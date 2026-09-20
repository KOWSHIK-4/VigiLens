/**
 * In-process Scheduled Reports scheduler.
 *
 * Automatically generates report records on a fixed local-day cadence
 * (daily / weekly / monthly) configured through the storage settings group:
 *   - scheduled_reports_enabled  (boolean switch)
 *   - report_cadence_days        (1 | 7 | 30)
 *   - report_digest_time         ("HH:MM" local digest anchor)
 *
 * The scheduler is deliberately conservative:
 *   - the first-ever pass primes the cadence (no report on first boot);
 *   - `runDue` is idempotent: a catch-up after an outage fires at most once;
 *   - runs never overlap; a stuck generation cannot pile up ticks;
 *   - generation is delegated to the report service (which produces a real
 *     Report row, rendered async and surfaced through the reports UI).
 *
 * Dependencies (setting readers, report generator, metrics hook, clock) are
 * injected so the scheduler can be unit-tested without a database.
 */

import { logger } from "../config/logger";
import { settingsService } from "./settings.service";
import { metricsService } from "./metrics.service";
import {
  DEFAULT_REPORT_SCHEDULE_CONFIG,
  decideSchedule,
  dateRangeFor,
  defaultReportTitle,
  clampCadence,
  parseDigestTime,
  type ReportScheduleConfig,
  type ReportScheduleState,
  type ScheduledReportType,
} from "./reportSchedulerPolicy";

export const SCHEDULED_REPORTS_ENABLED_KEY = "scheduled_reports_enabled";
export const REPORT_CADENCE_DAYS_KEY = "report_cadence_days";
export const REPORT_DIGEST_TIME_KEY = "report_digest_time";

export const REPORT_SCHEDULER_TICK_MS = 30_000;

export interface ReportSchedulerOptions {
  tickMs?: number;
  /** Reads the three storage-group scheduling settings. */
  configReader?: () => Promise<ReportScheduleConfig>;
  /** Generates one report record. Default: reportService.generate as "system". */
  generateReport?: (input: {
    title: string;
    type: ScheduledReportType;
    generatedBy: string;
    dateRange: { from: string; to: string };
  }) => Promise<{ id: string }>;
  /** Records that a scheduled report fired (metrics). */
  recordRun?: (type: ScheduledReportType) => Promise<void>;
  now?: () => number;
}

export interface ReportSchedulerStatus extends ReportScheduleState {
  running: boolean;
  startedAt: string | null;
  config: ReportScheduleConfig;
  runCount: number;
  lastError: string | null;
}

async function defaultConfigReader(): Promise<ReportScheduleConfig> {
  const [enabled, cadence, digestTime] = await Promise.all([
    settingsService.getValue("storage", SCHEDULED_REPORTS_ENABLED_KEY),
    settingsService.getValue("storage", REPORT_CADENCE_DAYS_KEY),
    settingsService.getValue("storage", REPORT_DIGEST_TIME_KEY),
  ]);
  return {
    enabled: enabled === true,
    cadenceDays: typeof cadence === "number" ? clampCadence(cadence) : DEFAULT_REPORT_SCHEDULE_CONFIG.cadenceDays,
    digestTime:
      typeof digestTime === "string" && parseDigestTime(digestTime)
        ? digestTime
        : DEFAULT_REPORT_SCHEDULE_CONFIG.digestTime,
  };
}

export async function defaultGenerateReport(input: {
  title: string;
  type: ScheduledReportType;
  generatedBy: string;
  dateRange: { from: string; to: string };
}): Promise<{ id: string }> {
  const { reportService } = await import("./report.service");
  return reportService.generate({
    title: input.title,
    type: input.type,
    generatedBy: input.generatedBy,
    dateRange: input.dateRange,
  });
}

async function defaultRecordRun(type: ScheduledReportType): Promise<void> {
  const REQUEST_COUNTS: Record<ScheduledReportType, number> = {
    daily: 1,
    weekly: 1,
    monthly: 1,
  };
  metricsService.recordEvent("reports.scheduled_generated", REQUEST_COUNTS[type]);
}

export class ReportScheduler {
  private readonly tickMs: number;
  private readonly configReader: () => Promise<ReportScheduleConfig>;
  private readonly generateReport: NonNullable<ReportSchedulerOptions["generateReport"]>;
  private readonly recordRun: NonNullable<ReportSchedulerOptions["recordRun"]>;
  private readonly now: () => number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startedAt: string | null = null;
  private lastRunAt: string | null = null;
  private nextRunAt: string | null = null;
  private runType: ScheduledReportType | null = null;
  private runCount = 0;
  private lastError: string | null = null;
  private lastConfig: ReportScheduleConfig = { ...DEFAULT_REPORT_SCHEDULE_CONFIG };
  private runInFlight = false;

  constructor(options: ReportSchedulerOptions = {}) {
    this.tickMs = options.tickMs ?? REPORT_SCHEDULER_TICK_MS;
    this.configReader = options.configReader ?? defaultConfigReader;
    this.generateReport = options.generateReport ?? defaultGenerateReport;
    this.recordRun = options.recordRun ?? defaultRecordRun;
    this.now = options.now ?? (() => Date.now());
  }

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date(this.now()).toISOString();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
    logger.info("Report scheduler started", { tickMs: this.tickMs });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Report scheduler stopped");
  }

  getStatus(): ReportSchedulerStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      lastRunAt: this.lastRunAt,
      nextRunAt: this.nextRunAt,
      runType: this.runType,
      config: { ...this.lastConfig },
      runCount: this.runCount,
      lastError: this.lastError,
    };
  }

  /**
   * One scheduling pass: generate exactly one report if a cadence anchor has
   * been reached since the last run. Public so tests can drive a single pass
   * without a real timer.
   */
  async tick(): Promise<void> {
    if (!this.running || this.runInFlight) return;
    const nowMs = this.now();
    const config = await this.configReader().catch(() => ({ ...DEFAULT_REPORT_SCHEDULE_CONFIG }));
    this.lastConfig = config;

    const lastRunOn = this.lastRunAt ? new Date(this.lastRunAt).getTime() : 0;
    const decision = decideSchedule(nowMs, config, lastRunOn);
    this.nextRunAt = decision.nextRunAt ? new Date(decision.nextRunAt).toISOString() : null;
    if (decision.type) this.runType = decision.type;

    if (!decision.shouldRun || !decision.type) return;

    this.runInFlight = true;
    const type = decision.type;
    try {
      const dateRange = dateRangeFor(nowMs, type);
      await this.generateReport({
        title: defaultReportTitle(nowMs, type),
        type,
        generatedBy: "system",
        dateRange,
      });
      await this.recordRun(type);
      this.lastRunAt = new Date(nowMs).toISOString();
      this.lastError = null;
      this.runCount += 1;
      logger.info("Scheduled report generated", { type, dateRange, runCount: this.runCount });
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.warn("Scheduled report generation failed", { error: this.lastError });
    } finally {
      this.runInFlight = false;
    }
  }
}

export const reportScheduler = new ReportScheduler();