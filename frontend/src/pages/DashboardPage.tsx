import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  Activity,
  Brain,
  Camera,
  ChevronRight,
  Cpu,
  Gauge,
  RefreshCw,
  ScanEye,
  ShieldAlert,
  ShieldCheck,
  Shield,
  UserCheck,
  Users,
  UserX,
  Wifi,
} from "lucide-react";
import { detectionService } from "@/services/detections";
import { modelService } from "@/services/models";
import { userService } from "@/services/users";
import { alertService } from "@/services/alerts";
import StatsCard from "@/components/StatsCard";
import DetectionCard from "@/components/DetectionCard";
import ModelStatusBadge from "@/components/ModelStatusBadge";
import DetectionImagePreview from "@/components/DetectionImagePreview";
import DetectionDetailsDrawer from "@/components/DetectionDetailsDrawer";
import AlertDetailsDrawer from "@/components/AlertDetailsDrawer";
import { hasPermission } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import { formatRelativeTime } from "@/utils/format";
import { getSeverityStyle } from "@/utils/statusConfig";
import type { Alert, Detection } from "@/types";
import type { TooltipProps } from "recharts";

const SEVERITY_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6"];

type SecurityLevel = "normal" | "warning" | "critical";

const SECURITY_CONFIG = {
  critical: {
    label: "Critical",
    headline: "Security condition is critical",
    badge: "bg-red-600 text-white",
    classes: "border-red-300 bg-red-50",
    icon: ShieldAlert,
    iconText: "text-red-600",
  },
  warning: {
    label: "Warning",
    headline: "Security condition is elevated",
    badge: "bg-amber-500 text-white",
    classes: "border-amber-300 bg-amber-50",
    icon: Shield,
    iconText: "text-amber-600",
  },
  normal: {
    label: "Normal",
    headline: "No active security threats",
    badge: "bg-green-600 text-white",
    classes: "border-green-300 bg-green-50",
    icon: ShieldCheck,
    iconText: "text-green-600",
  },
} as const;

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg p-3 text-sm">
      <p className="font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }} className="font-medium">
          {entry.name ?? entry.dataKey}:{" "}
          {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="h-[300px] flex flex-col items-center justify-center text-gray-400 gap-2">
      <ScanEye className="w-8 h-8 text-gray-300" />
      <p className="text-sm font-medium text-gray-500">{label}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded bg-gray-200" />
        <div className="h-4 w-72 rounded bg-gray-200" />
      </div>
      <div className="h-24 rounded-xl bg-gray-200 border border-gray-200" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3">
            <div className="h-4 w-28 rounded bg-gray-200" />
            <div className="h-8 w-16 rounded bg-gray-200" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[0, 1].map((i) => (
          <div key={i} className="card h-[300px]">
            <div className="h-5 w-40 rounded bg-gray-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const showUserStats = hasPermission(user, "users.read");
  const canSeeAlerts = hasPermission(user, "alerts.read");

  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState("Detection");

  const {
    data: stats,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => detectionService.getStats(),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const { data: activeModel } = useQuery({
    queryKey: ["models", "active"],
    queryFn: () =>
      modelService.getActive().catch(() => null),
    refetchInterval: 30000,
    placeholderData: keepPreviousData,
  });

  const { data: modelStats } = useQuery({
    queryKey: ["models", "stats"],
    queryFn: () => modelService.getAll({ page: 1, limit: 100 }),
    refetchInterval: 60000,
    placeholderData: keepPreviousData,
  });

  const enabledModels = useMemo(
    () => modelStats?.data.filter((m) => m.enabled).length ?? 0,
    [modelStats],
  );

  const { data: userStats } = useQuery({
    queryKey: ["users", "stats"],
    enabled: showUserStats,
    queryFn: () => userService.getStats(),
    refetchInterval: 60000,
    placeholderData: keepPreviousData,
  });

  const { data: latestAlerts } = useQuery({
    queryKey: ["alerts", "dashboard-latest"],
    enabled: canSeeAlerts,
    queryFn: () => alertService.getAll({ page: 1, limit: 8 }),
    refetchInterval: 15000,
    placeholderData: keepPreviousData,
  });

  const { data: criticalUnread } = useQuery({
    queryKey: ["alerts", "unread-count", "critical"],
    enabled: canSeeAlerts,
    queryFn: () =>
      alertService
        .getAll({ page: 1, limit: 1, severity: "critical", isRead: "false" })
        .then((res) => res.total),
    refetchInterval: 30000,
  });

  const { data: warningUnread } = useQuery({
    queryKey: ["alerts", "unread-count", "warning"],
    enabled: canSeeAlerts,
    queryFn: () =>
      alertService
        .getAll({ page: 1, limit: 1, severity: "warning", isRead: "false" })
        .then((res) => res.total),
    refetchInterval: 30000,
  });

  const securityLevel: SecurityLevel =
    !canSeeAlerts ? "normal"
    : (criticalUnread ?? 0) > 0 ? "critical"
    : (warningUnread ?? 0) > 0 ? "warning"
    : "normal";
  const security = SECURITY_CONFIG[securityLevel];
  const SecurityIcon = security.icon;
  const unreadAttention = securityLevel === "critical" ? criticalUnread : warningUnread;

  const detectionsOverTime = useMemo(
    () => stats?.detectionsOverTime ?? [],
    [stats],
  );
  const alertsByType = useMemo(() => stats?.alertsByType ?? [], [stats]);
  const recentDetections = useMemo(
    () => stats?.recentDetections ?? [],
    [stats],
  );
  const recentAlerts = latestAlerts?.data ?? [];

  if (isLoading && !stats) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium border border-green-200">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
              Live
            </span>
          </div>
          <p className="text-gray-500 mt-1 text-sm">
            Real-time security monitoring overview
          </p>
          {dataUpdatedAt > 0 && (
            <p className="text-xs text-gray-400 mt-1">
              Last updated {new Date(dataUpdatedAt).toLocaleTimeString()}
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
          <div>
            <p className="font-semibold text-red-700">
              Failed to load dashboard data
            </p>
            <p className="text-sm text-red-600 mt-1">
              The detection service could not be reached. Showing the last known
              state where available.
            </p>
          </div>
          <button onClick={() => refetch()} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      {canSeeAlerts && (
        <div
          className={`card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border ${security.classes}`}
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-xl bg-white shadow-sm flex items-center justify-center flex-shrink-0">
              <SecurityIcon className={`w-6 h-6 ${security.iconText}`} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${security.badge}`}
                >
                  {security.label}
                </span>
                {!!unreadAttention && (
                  <span className="text-xs font-medium text-gray-500">
                    {unreadAttention} unread alert
                    {unreadAttention === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <p className="font-semibold text-gray-900 mt-1">
                {security.headline}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900">
                {recentDetections.filter((d) => d.status === "critical").length}
              </p>
              <p className="text-xs text-gray-500">Critical events</p>
            </div>
            <div className="text-center">
              <p className="text-xl font-bold text-gray-900">
                {stats?.activeCameras ?? 0}
              </p>
              <p className="text-xs text-gray-500">Active cameras</p>
            </div>
            <Link
              to="/alerts"
              className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              View alerts
              <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Total Detections"
          value={stats?.totalDetections ?? 0}
          icon={<ScanEye className="w-4 h-4" />}
          tone="neutral"
        />
        <StatsCard
          title="Critical Detections"
          value={stats?.criticalAlerts ?? 0}
          icon={<ShieldAlert className="w-4 h-4" />}
          tone="red"
        />
        <StatsCard
          title="Active Cameras"
          value={stats?.activeCameras ?? 0}
          icon={<Camera className="w-4 h-4" />}
          tone="blue"
        />
        <StatsCard
          title="Avg Confidence"
          value={`${((stats?.avgConfidence ?? 0) * 100).toFixed(1)}%`}
          icon={<Gauge className="w-4 h-4" />}
          tone="green"
        />
      </div>

      {showUserStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard
            title="Total Users"
            value={userStats?.total ?? 0}
            icon={<Users className="w-4 h-4" />}
          />
          <StatsCard
            title="Online Now"
            value={userStats?.online ?? 0}
            icon={<Wifi className="w-4 h-4" />}
            tone="green"
          />
          <StatsCard
            title="Active Users"
            value={userStats?.active ?? 0}
            icon={<UserCheck className="w-4 h-4" />}
          />
          <StatsCard
            title="Disabled Users"
            value={userStats?.disabled ?? 0}
            icon={<UserX className="w-4 h-4" />}
            tone="red"
          />
        </div>
      )}

      <div className="card flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Brain className="w-6 h-6 text-brand-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-500">
              Active AI Model
            </p>
            {activeModel ? (
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <p className="font-semibold text-gray-900 truncate">
                  {activeModel.name}{" "}
                  <span className="text-gray-400 font-normal">
                    v{activeModel.version}
                  </span>
                </p>
                <ModelStatusBadge status={activeModel.status} />
                {activeModel.gpuSupported && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                    <Cpu className="w-3 h-3" />
                    GPU
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 mt-0.5">
                No model is currently active
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              {modelStats?.total ?? 0}
            </p>
            <p className="text-xs text-gray-500">Total Models</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{enabledModels}</p>
            <p className="text-xs text-gray-500">Enabled</p>
          </div>
          <Link
            to="/models"
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            Manage Models
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Detections Over Time
          </h3>
          {detectionsOverTime.length === 0 ? (
            <ChartEmpty label="No detection data available yet" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={detectionsOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Detections"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#3b82f6" }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Alerts by Type
          </h3>
          {alertsByType.length === 0 ? (
            <ChartEmpty label="No alert data available yet" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={alertsByType}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ label, percent }) =>
                    `${label} ${(percent * 100).toFixed(0)}%`
                  }
                >
                  {alertsByType.map((_: unknown, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={SEVERITY_COLORS[index % SEVERITY_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {canSeeAlerts && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Recent Alerts
              </h3>
              {recentAlerts.length > 0 && (
                <Link
                  to="/alerts"
                  className="text-sm font-medium text-brand-700 hover:text-brand-800 inline-flex items-center gap-1"
                >
                  View all
                  <ChevronRight className="w-4 h-4" />
                </Link>
              )}
            </div>
            {recentAlerts.length === 0 ? (
              <div className="card flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
                <ShieldCheck className="w-8 h-8 text-green-300" />
                <p className="font-medium text-gray-500">
                  No active security alerts
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recentAlerts.map((alert) => {
                  const style = getSeverityStyle(alert.severity);
                  const Icon = style.icon;
                  return (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={() => setSelectedAlert(alert)}
                      className="card w-full flex items-start gap-3 text-left hover:border-gray-300 hover:shadow-md transition-all group"
                    >
                      <span
                        className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot} ${
                          alert.isRead ? "opacity-30" : ""
                        }`}
                      />
                      <Icon
                        className={`w-5 h-5 mt-0.5 flex-shrink-0 ${style.iconColor}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full border ${style.badge}`}
                          >
                            {style.label}
                          </span>
                          {!alert.isRead && (
                            <span className="text-xs font-semibold text-brand-600 uppercase tracking-wide">
                              New
                            </span>
                          )}
                          <span className="text-xs text-gray-400">
                            {formatRelativeTime(alert.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 mt-1 truncate">
                          {alert.title}
                        </p>
                        <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">
                          {alert.message}
                        </p>
                        {alert.detection?.camera && (
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            Source: {alert.detection.camera.name}
                            {alert.detection.camera.location &&
                              ` — ${alert.detection.camera.location}`}
                          </p>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 self-center transition-colors" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Recent Detections
          </h3>
          {recentDetections.length === 0 ? (
            <div className="card flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
              <Activity className="w-8 h-8 text-gray-300" />
              <p className="font-medium text-gray-500">
                No active security events
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {recentDetections.map((detection: Detection) => (
                <DetectionCard
                  key={detection.id}
                  detection={detection}
                  onSelect={() => setSelectedDetection(detection)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <DetectionDetailsDrawer
        detection={selectedDetection}
        onClose={() => setSelectedDetection(null)}
        onPreview={(src) => {
          setPreviewLabel(selectedDetection?.label ?? "Detection");
          setSelectedDetection(null);
          setPreviewImage(src);
        }}
      />

      <AlertDetailsDrawer
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
        onViewDetection={(detection) => {
          setSelectedAlert(null);
          setSelectedDetection(detection);
        }}
      />

      {previewImage && (
        <DetectionImagePreview
          src={previewImage}
          label={previewLabel}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  );
}