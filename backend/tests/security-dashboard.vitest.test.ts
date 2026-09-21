import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../src/config/prisma";
import {
  buildFailedLoginSeries,
  localDateKey,
  securityDashboardService,
} from "../src/services/securityDashboard.service";

const FIXTURE_EMAIL = "sec-dash-fixture@vigilens.test";
const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

beforeEach(async () => {
  const existing = await prisma.user.findUnique({ where: { email: FIXTURE_EMAIL } });
  if (existing) {
    await prisma.auditLog.deleteMany({ where: { email: FIXTURE_EMAIL } });
    await prisma.user.delete({ where: { id: existing.id } });
  }
});

afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { email: FIXTURE_EMAIL } });
  await prisma.user.deleteMany({ where: { email: FIXTURE_EMAIL } });
});

describe("securityDashboardService", () => {
  it("reports locked accounts and failed login activity from live rows", async () => {
    const user = await prisma.user.create({
      data: {
        email: FIXTURE_EMAIL,
        name: "Security Dashboard Fixture",
        password: "unused-hash",
        role: "operator",
        status: "active",
        isLocked: true,
        failedLoginAttempts: 5,
        lockedAt: new Date(),
        organizationId: DEFAULT_ORG_ID,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        username: user.name,
        email: user.email,
        action: "user_login",
        module: "auth",
        description: "Login failed",
        ipAddress: "10.0.0.1",
        userAgent: "vitest",
        status: "failed",
        timestamp: new Date(),
      },
    });

    const dashboard = await securityDashboardService.getDashboard();

    expect(dashboard.accountPosture.lockedAccounts).toBeGreaterThanOrEqual(1);
    expect(dashboard.accountPosture.totalAccounts).toBeGreaterThanOrEqual(1);
    expect(dashboard.accountPosture.accountsWithFailedAttempts).toBeGreaterThanOrEqual(1);
    expect(
      dashboard.accountPosture.lockedAccountsList.some((a) => a.email === FIXTURE_EMAIL),
    ).toBe(true);
    expect(dashboard.authActivity.failedLogins24h).toBeGreaterThanOrEqual(1);
    expect(
      dashboard.authActivity.recentFailedLogins.some((l) => l.email === FIXTURE_EMAIL),
    ).toBe(true);
    expect(dashboard.policy.maxLoginAttempts).toBeGreaterThan(0);
    expect(dashboard.policy.lockoutDurationMinutes).toBeGreaterThan(0);
    expect(typeof dashboard.generatedAt).toBe("string");
  });

  it("exposes at-risk accounts (active, not locked, with failed attempts)", async () => {
    const user = await prisma.user.create({
      data: {
        email: FIXTURE_EMAIL,
        name: "At Risk Fixture",
        password: "unused-hash",
        role: "operator",
        status: "active",
        isLocked: false,
        failedLoginAttempts: 3,
        organizationId: DEFAULT_ORG_ID,
      },
    });

    const dashboard = await securityDashboardService.getDashboard();

    expect(
      dashboard.accountPosture.atRiskAccounts.some((a) => a.id === user.id),
    ).toBe(true);
  });

  it("includes a zero-filled 14-day failed-login series", async () => {
    const dashboard = await securityDashboardService.getDashboard();
    expect(dashboard.authActivity.failedLoginSeries).toHaveLength(14);
    for (const point of dashboard.authActivity.failedLoginSeries) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(point.count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildFailedLoginSeries", () => {
  it("fills a zero series when no rows exist", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const series = buildFailedLoginSeries([], 7, now);
    expect(series).toHaveLength(7);
    expect(series.every((p) => p.count === 0)).toBe(true);
    expect(series[0].date).toBe("2026-09-11");
    expect(series[series.length - 1].date).toBe("2026-09-17");
  });

  it("assigns counts to the correct local calendar day", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const series = buildFailedLoginSeries(
      [
        { date: new Date("2026-09-15T08:00:00"), count: 4 },
        { date: "2026-09-16", count: 2 },
      ],
      7,
      now,
    );
    expect(series.find((p) => p.date === "2026-09-15")?.count).toBe(4);
    expect(series.find((p) => p.date === "2026-09-16")?.count).toBe(2);
    expect(series.find((p) => p.date === "2026-09-17")?.count).toBe(0);
  });

  it("ignores malformed or out-of-window rows", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const series = buildFailedLoginSeries(
      [
        { date: null, count: 9 },
        { date: "not-a-date", count: 9 },
        { date: "2026-01-01", count: 9 },
        { date: "2026-09-17", count: 3 },
      ],
      7,
      now,
    );
    expect(series).toHaveLength(7);
    expect(series.reduce((s, p) => s + p.count, 0)).toBe(3);
  });

  it("sums duplicate days and matches localDateKey output", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    expect(localDateKey(new Date("2026-09-17T08:00:00"))).toBe("2026-09-17");
    const series = buildFailedLoginSeries(
      [
        { date: "2026-09-17", count: 1 },
        { date: "2026-09-17", count: 5 },
      ],
      3,
      now,
    );
    expect(series.find((p) => p.date === "2026-09-17")?.count).toBe(6);
  });
});