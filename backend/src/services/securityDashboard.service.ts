import { prisma } from "../config/prisma";
import { settingsService } from "./settings.service";

const DAY_MS = 86_400_000;

export interface FailedLoginPoint {
  date: string;
  count: number;
}

/** Local YYYY-MM-DD for a given instant. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Converts date-grouped failed-login rows into a zero-filled daily series
 * covering the last `days` local calendar days (today inclusive). Rows that
 * fall outside the window or lack a parseable date are ignored. Pure so it
 * can be unit tested without a database.
 */
export function buildFailedLoginSeries(
  rows: { date: string | Date | null; count: number }[],
  days: number,
  now = new Date(),
): FailedLoginPoint[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key =
      row.date instanceof Date
        ? localDateKey(row.date)
        : typeof row.date === "string"
          ? row.date.slice(0, 10)
          : null;
    if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + (Number.isFinite(row.count) ? row.count : 0));
  }

  const series: FailedLoginPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const day = new Date(now.getTime() - offset * DAY_MS);
    const key = localDateKey(day);
    series.push({ date: key, count: counts.get(key) ?? 0 });
  }
  return series;
}

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

    const [failedLogins24h, failedLogins7d, failedLogins30d, failedLoginRows] = await Promise.all([
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
      prisma.$queryRaw<{ date: Date; count: number }[]>`
        SELECT DATE(timestamp) as date, COUNT(*)::int as count
        FROM audit_logs
        WHERE module = 'auth'
          AND action = 'user_login'
          AND status = 'failed'
          AND timestamp >= NOW() - INTERVAL '14 days'
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `,
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
        failedLoginSeries: buildFailedLoginSeries(failedLoginRows, 14, now),
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