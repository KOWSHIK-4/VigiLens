/**
 * Scheduled reports — unit tests.
 *
 * Pure policy layer: cadence anchoring, month clamping, window arithmetic and
 * due-decision logic. Scheduler layer: injectable clock, config reader and
 * report generator verify first-boot priming, catch-up and no-double-fire.
 */

import { describe, expect, it, vi } from "vitest";
import {
  parseDigestTime,
  clampCadence,
  reportTypeForCadence,
  nextScheduledAt,
  dateRangeFor,
  defaultReportTitle,
  addMonths,
  decideSchedule,
  DAY_MS,
  type ReportScheduleConfig,
} from "../src/services/reportSchedulerPolicy";
import { parseCadenceDays } from "../src/services/reportScheduler.service";

const enabledDaily: ReportScheduleConfig = {
  enabled: true,
  cadenceDays: 1,
  digestTime: "06:00",
};

describe("reportSchedulerPolicy (pure)", () => {
  it("parses digest times strictly and rejects malformed input", () => {
    expect(parseDigestTime("06:00")).toEqual([6, 0]);
    expect(parseDigestTime(" 23:59 ")).toEqual([23, 59]);
    expect(parseDigestTime("6:00")).toEqual([6, 0]);
    expect(parseDigestTime("24:00")).toBeNull();
    expect(parseDigestTime("06:60")).toBeNull();
    expect(parseDigestTime("6am")).toBeNull();
    expect(parseDigestTime("")).toBeNull();
  });

  it("clamps cadences to the supported set and derives the report type", () => {
    expect(clampCadence(-5)).toBe(1);
    expect(clampCadence(1)).toBe(1);
    expect(clampCadence(7)).toBe(7);
    expect(clampCadence(30)).toBe(30);
    expect(clampCadence(999)).toBe(30);
    expect(reportTypeForCadence(1)).toBe("daily");
    expect(reportTypeForCadence(7)).toBe("weekly");
    expect(reportTypeForCadence(30)).toBe("monthly");
  });

  it("anchors the next run at digest time on the cadence", () => {
    const now = new Date("2026-09-19T04:00:00Z").getTime();
    const next = new Date(nextScheduledAt(now, enabledDaily));
    expect(next.getUTCHours()).toBe(6);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getTime() - now).toBe(2 * 3_600_000);
  });

  it("waits for the following anchor when the digest time already passed", () => {
    const now = new Date("2026-09-19T07:00:00Z").getTime();
    const next = new Date(nextScheduledAt(now, enabledDaily));
    expect(next.getTime() - now).toBe(23 * 3_600_000);
  });

  it("computes daily and weekly coverage windows", () => {
    const now = new Date("2026-09-19T06:00:00Z").getTime();
    const daily = dateRangeFor(now, "daily");
    expect(daily.from).toBe(new Date(now - DAY_MS).toISOString());
    expect(daily.to).toBe(new Date(now).toISOString());
    const weekly = dateRangeFor(now, "weekly");
    expect(weekly.from).toBe(new Date(now - 7 * DAY_MS).toISOString());
  });

  it("computes monthly windows that clamp across short months", () => {
    const now = new Date("2026-03-31T06:00:00Z").getTime();
    const monthly = dateRangeFor(now, "monthly");
    expect(monthly.from).toBe(new Date("2026-02-28T06:00:00Z").toISOString());
    expect(addMonths(new Date("2026-01-31T06:00:00Z"), 1).toISOString()).toBe(
      new Date("2026-02-28T06:00:00Z").toISOString(),
    );
  });

  it("builds a dated human-readable title", () => {
    const now = new Date("2026-09-19T06:00:00Z").getTime();
    expect(defaultReportTitle(now, "weekly")).toBe("Scheduled weekly report 2026-09-19");
  });

  it("primes without firing on the very first run", () => {
    const now = new Date("2026-09-19T00:00:00Z").getTime();
    const decision = decideSchedule(now, enabledDaily, null);
    expect(decision.shouldRun).toBe(false);
    expect(decision.nextRunAt).toBe(
      new Date("2026-09-19T06:00:00Z").getTime(),
    );
  });

  it("does not fire before the anchor and fires once the window opens after it", () => {
    const before = new Date("2026-09-19T05:59:00Z").getTime();
    const early = decideSchedule(before, enabledDaily, before - DAY_MS);
    expect(early.shouldRun).toBe(false);

    const atAnchor = new Date("2026-09-19T06:00:30Z").getTime();
    const due = decideSchedule(atAnchor, enabledDaily, atAnchor - DAY_MS);
    expect(due.shouldRun).toBe(true);
    expect(due.type).toBe("daily");
  });

  it("does not refire within the same open window as the last run", () => {
    const windowOpen = new Date("2026-09-19T06:05:00Z").getTime();
    const lastRanSameWindow = new Date("2026-09-19T06:01:00Z").getTime();
    const sameDay = decideSchedule(windowOpen, enabledDaily, lastRanSameWindow);
    expect(sameDay.shouldRun).toBe(false);
  });

  it("is disabled when the switch is off regardless of cadence", () => {
    const now = new Date("2026-09-19T06:00:00Z").getTime();
    const decision = decideSchedule(now, { ...enabledDaily, enabled: false }, now - DAY_MS);
    expect(decision.shouldRun).toBe(false);
    expect(decision.nextRunAt).toBeNull();
  });
});

describe("ReportScheduler (injectable dependencies)", () => {
  it("fires exactly once per elapsed cadence and never double-fires", async () => {
    const config = { ...enabledDaily, digestTime: "06:00" };
    let clock = new Date("2026-09-19T00:00:00Z").getTime();

    const generated = vi.fn().mockResolvedValue({ id: "rep-1" });
    const recorded = vi.fn().mockResolvedValue(undefined);

    const { ReportScheduler } = await import("../src/services/reportScheduler.service");
    const scheduler = new ReportScheduler({
      tickMs: 1_000_000,
      configReader: async () => ({ ...config }),
      organizationsProvider: async () => [{ id: "org-1" }],
      generateReport: generated,
      recordRun: recorded,
      now: () => clock,
    });
    scheduler.start();
    await scheduler.tick(); // before the anchor -> primes
    expect(generated).not.toHaveBeenCalled();

    // A full cadence passes past the anchor: the report fires exactly once.
    clock = new Date("2026-09-20T06:05:00Z").getTime();
    await scheduler.tick();
    expect(generated).toHaveBeenCalledTimes(1);

    // Fast consecutive passes must not double-fire.
    clock = new Date("2026-09-20T06:06:00Z").getTime();
    await scheduler.tick();
    expect(generated).toHaveBeenCalledTimes(1);
    expect(recorded).toHaveBeenCalledTimes(1);
    expect(generated.mock.calls[0][0].type).toBe("daily");
    expect(generated.mock.calls[0][0].generatedBy).toBe("system");
    expect(generated.mock.calls[0][0].organizationId).toBe("org-1");
    scheduler.stop();
  });

  it("never fires on a fresh process until the first anchor", async () => {
    const nowMs = new Date("2026-09-19T04:00:00Z").getTime();
    const generated = vi.fn().mockResolvedValue({ id: "none" });
    const { ReportScheduler } = await import("../src/services/reportScheduler.service");
    const scheduler = new ReportScheduler({
      tickMs: 1_000_000,
      configReader: async () => ({ ...enabledDaily }),
      organizationsProvider: async () => [{ id: "org-1" }],
      generateReport: generated,
      recordRun: async () => undefined,
      now: () => nowMs,
    });
    scheduler.start();
    await scheduler.tick();
    expect(generated).not.toHaveBeenCalled();
    expect(scheduler.getStatus().nextRunAt).toBe(
      new Date("2026-09-19T06:00:00Z").toISOString(),
    );
    scheduler.stop();
  });

  it("does not fire when scheduling is disabled", async () => {
    const nowMs = new Date("2026-09-19T06:30:00Z").getTime();
    const generated = vi.fn().mockResolvedValue({ id: "none" });
    const { ReportScheduler } = await import("../src/services/reportScheduler.service");
    const scheduler = new ReportScheduler({
      tickMs: 1_000_000,
      configReader: async () => ({ ...enabledDaily, enabled: false }),
      organizationsProvider: async () => [{ id: "org-1" }],
      generateReport: generated,
      recordRun: async () => undefined,
      now: () => nowMs,
    });
    scheduler.start();
    await scheduler.tick();
    expect(generated).not.toHaveBeenCalled();
    expect(scheduler.getStatus().lastRunAt).toBeNull();
    scheduler.stop();
  });

  it("fires independently per organization from its own schedule", async () => {
    const clock = new Date("2026-09-19T06:05:00Z").getTime();
    const generated = vi.fn().mockResolvedValue({ id: "rep-x" });
    const configByOrg: Record<string, ReportScheduleConfig> = {
      "org-a": { ...enabledDaily },
      "org-b": { ...enabledDaily, enabled: false },
    };
    const { ReportScheduler } = await import("../src/services/reportScheduler.service");
    const scheduler = new ReportScheduler({
      tickMs: 1,
      configReader: async (orgId) => ({ ...configByOrg[orgId] }),
      organizationsProvider: async () => [{ id: "org-a" }, { id: "org-b" }],
      generateReport: generated,
      recordRun: async () => undefined,
      now: () => clock,
    });
    scheduler.start();
    await scheduler.tick();
    expect(generated).toHaveBeenCalledTimes(1);
    expect(generated.mock.calls[0][0].organizationId).toBe("org-a");
    scheduler.stop();
  });
});

describe("parseCadenceDays (settings values are stored as select strings)", () => {
  it("accepts numeric strings and numbers and clamps to the supported set", () => {
    expect(parseCadenceDays("1")).toBe(1);
    expect(parseCadenceDays("7")).toBe(7);
    expect(parseCadenceDays("30")).toBe(30);
    expect(parseCadenceDays(1)).toBe(1);
    expect(parseCadenceDays(7)).toBe(7);
    expect(parseCadenceDays(30)).toBe(30);
    expect(parseCadenceDays("999")).toBe(30);
  });

  it("falls back to daily for unparseable or missing values", () => {
    expect(parseCadenceDays("weekly")).toBe(1);
    expect(parseCadenceDays("")).toBe(1);
    expect(parseCadenceDays(undefined)).toBe(1);
    expect(parseCadenceDays(null)).toBe(1);
  });
});