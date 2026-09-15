import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "../src/config/prisma";
import { securityDashboardService } from "../src/services/securityDashboard.service";

const FIXTURE_EMAIL = "sec-dash-fixture@vigilens.test";

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
      },
    });

    const dashboard = await securityDashboardService.getDashboard();

    expect(
      dashboard.accountPosture.atRiskAccounts.some((a) => a.id === user.id),
    ).toBe(true);
  });
});