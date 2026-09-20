/**
 * Scheduled report policy — pure scheduling math.
 *
 * Decoupled from timers and the database so the cadence calculation can be
 * unit-tested deterministically. Anchors are computed in UTC (the system's
 * canonical timestamp convention); a month tap clamps to the last day of the
 * target month so a monthly report triggered on the 31st does not drift.
 */

export type ReportCadenceDays = 1 | 7 | 30;

export type ScheduledReportType = "daily" | "weekly" | "monthly";

export interface ReportScheduleConfig {
  enabled: boolean;
  cadenceDays: number;
  digestTime: string;
}

export interface ReportScheduleState {
  lastRunAt: string | null;
  nextRunAt: string | null;
  runType: ScheduledReportType | null;
}

export const DEFAULT_REPORT_SCHEDULE_CONFIG = {
  enabled: false,
  cadenceDays: 1,
  digestTime: "06:00",
} satisfies ReportScheduleConfig;

export const EMPTY_REPORT_SCHEDULE_STATE: ReportScheduleState = {
  lastRunAt: null,
  nextRunAt: null,
  runType: null,
};

export const DAY_MS = 86_400_000;

/** Parses "HH:MM" into [hour, minute], returning null for malformed input. */
export function parseDigestTime(value: string): [number, number] | null {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return [hour, minute];
}

/** Returns the digest time's UTC anchor on the given day. */
export function digestAnchor(nowMs: number, digestTime: string): number {
  const parsed = parseDigestTime(digestTime);
  const [hour, minute] = parsed ?? [6, 0];
  const anchor = new Date(nowMs);
  return Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
    hour,
    minute,
    0,
    0,
  );
}

/**
 * The digest anchor of the current period: today's anchor when its time has
 * been reached, or the upcoming anchor when digest time has not arrived yet
 * (which is still "today's window", just not open). A false reading through a
 * plain subtraction is avoided by stepping whole cadence periods instead.
 */
/**
 * The digest anchor of the current period: today's anchor when its time has
 * been reached, or the upcoming anchor when digest time has not arrived yet
 * (which is still "today's window", just not open).
 */
export function todayAnchor(nowMs: number, config: ReportScheduleConfig): number {
  return digestAnchor(nowMs, config.digestTime);
}

/**
 * The next scheduled run: the upcoming anchor when the current window has not
 * opened yet, otherwise the anchor one full cadence ahead of the current one.
 */
export function nextScheduledAt(nowMs: number, config: ReportScheduleConfig): number {
  const anchor = digestAnchor(nowMs, config.digestTime);
  const cadence = clampCadence(config.cadenceDays);
  let next = anchor;
  while (next < nowMs) {
    next += cadence * DAY_MS;
  }
  return next;
}

export function clampCadence(value: number): 1 | 7 | 30 {
  if (value >= 30) return 30;
  if (value >= 7) return 7;
  return 1;
}

export function reportTypeForCadence(value: number): ScheduledReportType {
  const cadence = clampCadence(value);
  if (cadence === 7) return "weekly";
  if (cadence === 30) return "monthly";
  return "daily";
}

/** Adds whole months, clamping the day to the target month's last day. */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** The period a scheduled report should cover, given its type. */
export function dateRangeFor(nowMs: number, type: ScheduledReportType): { from: string; to: string } {
  const now = new Date(nowMs);
  const to = new Date(now.getTime());
  to.setSeconds(0, 0);
  let from: Date;
  switch (type) {
    case "daily":
      from = new Date(now.getTime() - DAY_MS);
      break;
    case "weekly":
      from = new Date(now.getTime() - 7 * DAY_MS);
      break;
    case "monthly":
      from = addMonths(now, -1);
      break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

export function defaultReportTitle(nowMs: number, type: ScheduledReportType): string {
  const now = new Date(nowMs);
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return `Scheduled ${type} report ${stamp}`;
}

export interface ScheduleDecision {
  shouldRun: boolean;
  type: ScheduledReportType | null;
  nextRunAt: number | null;
}

/**
 * Evaluate whether a report is due. A report is due exactly once per cadence
 * window: when the report window (today's digest anchor) has opened and the
 * last run happened before it opened, so a run minutes after digest time does
 * not claim the new window and consecutive ticks cannot double-fire. Restarts
 * and outages simply yield at most one catch-up generation.
 */
export function decideSchedule(
  nowMs: number,
  config: ReportScheduleConfig,
  lastRunOn: number | null,
): ScheduleDecision {
  if (!config.enabled) {
    return { shouldRun: false, type: null, nextRunAt: null };
  }
  // A fresh process passes 0 (epoch): the report fires as soon as the digest
  // window is open, which doubles as catch-up after downtime. Before the
  // window opens nothing fires and the upcoming anchor is primed.
  const last = lastRunOn ?? 0;
  const openAnchor = todayAnchor(nowMs, config);
  const windowOpen = openAnchor < nowMs;
  const preceded = last < openAnchor;
  if (windowOpen && preceded) {
    return {
      shouldRun: true,
      type: reportTypeForCadence(config.cadenceDays),
      nextRunAt: nextScheduledAt(nowMs, config),
    };
  }
  return { shouldRun: false, type: null, nextRunAt: nextScheduledAt(nowMs, config) };
}