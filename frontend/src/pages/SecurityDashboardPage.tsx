import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Timer,
  UserX,
} from "lucide-react";
import { securityService } from "@/services/security";
import { formatRelativeTime } from "@/utils/format";
import { roleLabel } from "@/utils/permissions";
import type { SecurityPolicy } from "@/types";

type PostureLevel = "good" | "attention" | "critical";

function postureFrom(dashboard: {
  accountPosture: {
    lockedAccounts: number;
    accountsWithFailedAttempts: number;
    mustChangePasswordAccounts: number;
  };
  authActivity: { failedLogins24h: number };
}): PostureLevel {
  if (dashboard.accountPosture.lockedAccounts > 0 || dashboard.authActivity.failedLogins24h > 0) {
    return "critical";
  }
  if (
    dashboard.accountPosture.accountsWithFailedAttempts > 0 ||
    dashboard.accountPosture.mustChangePasswordAccounts > 0
  ) {
    return "attention";
  }
  return "good";
}

const POSTURE_CONFIG = {
  good: {
    label: "Good",
    headline: "No locked accounts or recent failed login attempts",
    icon: ShieldCheck,
    classes: "border-green-300 bg-green-50",
    iconColor: "text-green-600",
  },
  attention: {
    label: "Attention",
    headline: "Some accounts need attention (failed attempts or password changes)",
    icon: AlertTriangle,
    classes: "border-amber-300 bg-amber-50",
    iconColor: "text-amber-600",
  },
  critical: {
    label: "Critical",
    headline: "Locked accounts or recent failed login attempts detected",
    icon: ShieldAlert,
    classes: "border-red-300 bg-red-50",
    iconColor: "text-red-600",
  },
} as const;

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function PolicySummary({ policy }: { policy: SecurityPolicy }) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Security Policy</h3>
      <PolicyRow label="Login attempt limit" value={`${policy.maxLoginAttempts} attempts`} />
      <PolicyRow label="Lockout duration" value={`${policy.lockoutDurationMinutes} min`} />
      <PolicyRow label="Min password length" value={`${policy.passwordMinLength} chars`} />
      <PolicyRow label="Complex passwords" value={policy.requirePasswordComplexity ? "Required" : "Optional"} />
      <PolicyRow label="JWT lifetime" value={`${policy.jwtExpirationHours} hrs`} />
      <PolicyRow label="HTTPS required" value={policy.jwtRequireHttps ? "Yes" : "No"} />
      <PolicyRow label="Session timeout" value={`${policy.sessionTimeoutMinutes} min`} />
      <div className="border-t border-gray-100 pt-3 mt-1">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          Manage policies
          <ChevronRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function AccountRow({ user }: { user: { name: string; email: string; role: string; lockedAt?: string | null; failedLoginAttempts: number } }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{user.name}</p>
        <p className="text-xs text-gray-500 truncate">{user.email}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-xs text-gray-500">{roleLabel(user.role)}</p>
        <p className="text-xs text-gray-400">
          {user.lockedAt ? formatRelativeTime(user.lockedAt) : `${user.failedLoginAttempts} attempts`}
        </p>
      </div>
    </div>
  );
}

export default function SecurityDashboardPage() {
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["security", "dashboard"],
    queryFn: () => securityService.getDashboard(),
    refetchInterval: 30000,
  });

  const posture = data ? postureFrom(data) : "good";
  const config = POSTURE_CONFIG[posture];
  const PostureIcon = config.icon;

  if (isLoading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-56 rounded bg-gray-200" />
          <div className="h-4 w-72 rounded bg-gray-200" />
        </div>
        <div className="h-28 rounded-xl bg-gray-200" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card h-24" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card h-64" />
          <div className="card h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Operations</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Account posture, authentication activity and effective security policy
          </p>
          {dataUpdatedAt > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {isError && (
        <div className="card flex flex-col items-center gap-3 border-red-200 bg-red-50 py-8 text-center">
          <ShieldAlert className="w-8 h-8 text-red-500" />
          <p className="font-semibold text-red-700">Failed to load security dashboard</p>
          <button onClick={() => refetch()} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      {data && (
        <>
          <div className={`card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border ${config.classes}`}>
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0">
                <PostureIcon className={`w-6 h-6 ${config.iconColor}`} />
              </div>
              <div className="min-w-0">
                <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-white text-gray-800 border border-gray-200">
                  {config.label}
                </span>
                <p className="font-semibold text-gray-900 mt-1">{config.headline}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6 text-sm">
              <div>
                <p className="text-xs text-gray-500">Locked</p>
                <p className="text-xl font-bold text-gray-900">{data.accountPosture.lockedAccounts}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Failed logins 24h</p>
                <p className="text-xl font-bold text-gray-900">{data.authActivity.failedLogins24h}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Require PW change</p>
                <p className="text-xl font-bold text-gray-900">{data.accountPosture.mustChangePasswordAccounts}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.accountPosture.lockedAccounts}</p>
                <p className="text-sm text-gray-500">Locked accounts</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.accountPosture.accountsWithFailedAttempts}</p>
                <p className="text-sm text-gray-500">Accounts w/ failed attempts</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                <KeyRound className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.authActivity.failedLogins7d}</p>
                <p className="text-sm text-gray-500">Failed logins last 7 days</p>
              </div>
            </div>
            <div className="card flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <UserX className="w-6 h-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.accountPosture.disabledAccounts}</p>
                <p className="text-sm text-gray-500">Disabled accounts</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Locked Accounts</h3>
                <Link to="/users" className="text-sm font-medium text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
                  Manage users <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              {data.accountPosture.lockedAccountsList.length === 0 ? (
                <div className="flex items-center gap-2 py-8 text-gray-400">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <p className="text-sm text-gray-500">No accounts are currently locked</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.accountPosture.lockedAccountsList.map((user) => (
                    <AccountRow key={user.id} user={user} />
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">At-Risk Accounts</h3>
              {data.accountPosture.atRiskAccounts.length === 0 ? (
                <div className="flex items-center gap-2 py-8 text-gray-400">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <p className="text-sm text-gray-500">No accounts approaching lockout</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.accountPosture.atRiskAccounts.map((user) => (
                    <AccountRow key={user.id} user={user} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Failed Logins</h3>
              {data.authActivity.recentFailedLogins.length === 0 ? (
                <div className="flex items-center gap-2 py-8 text-gray-400">
                  <CheckCircle2 className="w-5 h-5 text-green-400" />
                  <p className="text-sm text-gray-500">No failed logins in the last 24 hours</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {data.authActivity.recentFailedLogins.map((log) => (
                    <div key={log.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {log.username || log.email || "Unknown user"}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{log.description}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs text-gray-500">{formatRelativeTime(log.timestamp)}</p>
                        <p className="text-xs text-gray-400">{log.ipAddress}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <PolicySummary policy={data.policy} />
              <div className="card flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-50 text-gray-600 flex items-center justify-center">
                  <Timer className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{data.authActivity.failedLogins30d}</p>
                  <p className="text-sm text-gray-500">Failed logins over the last 30 days</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}