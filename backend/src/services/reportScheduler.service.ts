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

/**
 * Settings expose the cadence as a select whose values are stored as strings
 * ("1" | "7" | "30"), but older code expected a number and silently ignored
 * the stored value, pinning every tenant to daily reports. Accept both.
 */
export function parseCadenceDays(value: unknown): 1 | 7 | 30 {
  if (typeof value === "number") return clampCadence(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return clampCadence(Number(value.trim()));
  }
  return DEFAULT_REPORT_SCHEDULE_CONFIG.cadenceDays as 1 | 7 | 30;
}

export interface ReportSchedulerOptions {
  tickMs?: number;
  /**
   * Reads the three storage-group scheduling settings for one organization.
   * Settings are scoped per tenant (falling back to platform defaults when a
   * tenant has no override), so each organization's schedule — and whether it
   * is enabled at all — is its own.
   */
  configReader?: (organizationId: string) => Promise<ReportScheduleConfig>;
  /** The tenants scheduled reports are generated for. Default: all active orgs. */
  organizationsProvider?: () => Promise<Array<{ id: string }>>;
  /** Generates one report record for an organization. Default: reportService.generate as "system". */
  generateReport?: (input: {
    title: string;
    type: ScheduledReportType;
    generatedBy: string;
    dateRange: { from: string; to: string };
    organizationId: string;
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

async function defaultConfigReader(organizationId: string): Promise<ReportScheduleConfig> {
  const [enabled, cadence, digestTime] = await Promise.all([
    settingsService.getValue("storage", SCHEDULED_REPORTS_ENABLED_KEY, organizationId),
    settingsService.getValue("storage", REPORT_CADENCE_DAYS_KEY, organizationId),
    settingsService.getValue("storage", REPORT_DIGEST_TIME_KEY, organizationId),
  ]);
  return {
    enabled: enabled === true,
    cadenceDays: parseCadenceDays(cadence),
    digestTime:
      typeof digestTime === "string" && parseDigestTime(digestTime)
        ? digestTime
        : DEFAULT_REPORT_SCHEDULE_CONFIG.digestTime,
  };
}

async function defaultOrganizationsProvider(): Promise<Array<{ id: string }>> {
  const { prisma } = await import("../config/prisma");
  return prisma.organization.findMany({
    select: { id: true },
  });
}

export async function defaultGenerateReport(input: {
  title: string;
  type: ScheduledReportType;
  generatedBy: string;
  dateRange: { from: string; to: string };
  organizationId: string;
}): Promise<{ id: string }> {
  const { reportService } = await import("./report.service");
  return reportService.generate({
    title: input.title,
    type: input.type,
    generatedBy: input.generatedBy,
    dateRange: input.dateRange,
    organizationId: input.organizationId,
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
  private readonly configReader: NonNullable<ReportSchedulerOptions["configReader"]>;
  private readonly organizationsProvider: NonNullable<ReportSchedulerOptions["organizationsProvider"]>;
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
  private readonly lastRunByOrg = new Map<string, string>();

  constructor(options: ReportSchedulerOptions = {}) {
    this.tickMs = options.tickMs ?? REPORT_SCHEDULER_TICK_MS;
    this.configReader = options.configReader ?? defaultConfigReader;
    this.organizationsProvider = options.organizationsProvider ?? defaultOrganizationsProvider;
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
   * One scheduling pass: for every tenant whose cadence anchor has been
   * reached since its last run, generate an organization-scoped report. Public
   * so tests can drive a single pass without a real timer.
   */
  async tick(): Promise<void> {
    if (!this.running || this.runInFlight) return;
    const nowMs = this.now();
    const orgs = await this.organizationsProvider().catch(() => []);
    const firedAt: number[] = [];

    this.runInFlight = true;
    this.lastError = null;
    this.nextRunAt = null;
    this.runType = null;
    try {
      for (const org of orgs) {
        const config = await this.configReader(org.id).catch(() => ({ ...DEFAULT_REPORT_SCHEDULE_CONFIG }));
        this.lastConfig = config;

        const lastRunOn = this.lastRunByOrg.has(org.id)
          ? new Date(this.lastRunByOrg.get(org.id) as string).getTime()
          : 0;
        const decision = decideSchedule(nowMs, config, lastRunOn);
        if (decision.nextRunAt !== null) {
          const next = new Date(decision.nextRunAt).getTime();
          if (this.nextRunAt === null || next < new Date(this.nextRunAt).getTime()) {
            this.nextRunAt = new Date(next).toISOString();
          }
        }
        if (!decision.shouldRun || !decision.type) continue;
        this.runType = decision.type;

        const dateRange = dateRangeFor(nowMs, decision.type);
        await this.generateReport({
          title: defaultReportTitle(nowMs, decision.type),
          type: decision.type,
          generatedBy: "system",
          dateRange,
          organizationId: org.id,
        });
        await this.recordRun(decision.type);
        this.lastRunByOrg.set(org.id, new Date(nowMs).toISOString());
        firedAt.push(nowMs);
        logger.info("Scheduled report generated", { organizationId: org.id, type: decision.type, dateRange });
      }

      if (firedAt.length > 0) {
        this.lastRunAt = new Date(Math.max(...firedAt)).toISOString();
        this.runCount += firedAt.length;
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      logger.warn("Scheduled report generation failed", { error: this.lastError });
    } finally {
      this.runInFlight = false;
    }
  }
}

export const reportScheduler = new ReportScheduler();