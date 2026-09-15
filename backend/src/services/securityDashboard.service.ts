import { prisma } from "../config/prisma";
import { settingsService } from "./settings.service";

const DAY_MS = 86_400_000;

const accountSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  isLocked: true,
  failedLoginAttempts: true,
  lockedAt: true,
  mustChangePassword: true,
  lastLogin: true,
  createdAt: true,
} as const;

export const securityDashboardService = {
  /**
   * Aggregates account posture, recent authentication activity and the
   * effective security policy into a single snapshot for the operations
   * dashboard. Every figure is computed from live database rows; nothing
   * is cached so the view always reflects the current state.
   */
  async getDashboard() {
    const now = new Date();
    const recent24h = new Date(now.getTime() - DAY_MS);
    const recent7d = new Date(now.getTime() - 7 * DAY_MS);

    const [
      totalAccounts,
      activeAccounts,
      disabledAccounts,
      lockedAccounts,
      failedLoginAttemptsTotal,
      mustChangePasswordAccounts,
      lockedAccountsList,
      atRiskAccounts,
      recentFailedLogins,
    ] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, status: "active" } }),
      prisma.user.count({ where: { deletedAt: null, status: "disabled" } }),
      prisma.user.count({ where: { deletedAt: null, isLocked: true } }),
      prisma.user.count({
        where: { deletedAt: null, failedLoginAttempts: { gt: 0 } },
      }),
      prisma.user.count({
        where: { deletedAt: null, mustChangePassword: true },
      }),
      prisma.user.findMany({
        where: { deletedAt: null, isLocked: true },
        select: accountSelect,
        orderBy: { lockedAt: "desc" },
        take: 10,
      }),
      prisma.user.findMany({
        where: {
          deletedAt: null,
          isLocked: false,
          status: "active",
          failedLoginAttempts: { gt: 0 },
        },
        select: accountSelect,
        orderBy: { failedLoginAttempts: "desc" },
        take: 10,
      }),
      prisma.auditLog.findMany({
        where: {
          module: "auth",
          action: "user_login",
          status: "failed",
          timestamp: { gte: recent24h },
        },
        select: {
          id: true,
          timestamp: true,
          username: true,
          email: true,
          description: true,
          ipAddress: true,
        },
        orderBy: { timestamp: "desc" },
        take: 10,
      }),
    ]);

    const [failedLogins24h, failedLogins7d, failedLogins30d] = await Promise.all([
      prisma.auditLog.count({
        where: {
          module: "auth",
          action: "user_login",
          status: "failed",
          timestamp: { gte: recent24h },
        },
      }),
      prisma.auditLog.count({
        where: {
          module: "auth",
          action: "user_login",
          status: "failed",
          timestamp: { gte: recent7d },
        },
      }),
      prisma.auditLog.count({
        where: {
          module: "auth",
          action: "user_login",
          status: "failed",
          timestamp: { gte: new Date(now.getTime() - 30 * DAY_MS) },
        },
      }),
    ]);

    const policyRows = await settingsService.getByCategory("security");
    const policyValue = (key: string) =>
      policyRows.find((row) => row.key === key)?.value;

    return {
      generatedAt: now.toISOString(),
      accountPosture: {
        totalAccounts,
        activeAccounts,
        disabledAccounts,
        lockedAccounts,
        accountsWithFailedAttempts: failedLoginAttemptsTotal,
        mustChangePasswordAccounts,
        lockedAccountsList,
        atRiskAccounts,
      },
      authActivity: {
        failedLogins24h,
        failedLogins7d,
        failedLogins30d,
        recentFailedLogins,
      },
      policy: {
        maxLoginAttempts: Number(policyValue("max_login_attempts") ?? 5),
        lockoutDurationMinutes: Number(policyValue("lockout_duration_minutes") ?? 15),
        passwordMinLength: Number(policyValue("password_min_length") ?? 8),
        requirePasswordComplexity: policyValue("password_require_complexity") === true,
        jwtExpirationHours: Number(policyValue("jwt_expiration_hours") ?? 168),
        jwtRequireHttps: policyValue("jwt_require_https") === true,
        sessionTimeoutMinutes: Number(policyValue("session_timeout_minutes") ?? 30),
      },
    };
  },
};