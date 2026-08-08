import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";
import { systemService } from "@/services/system";
import StatusBadge from "@/components/StatusBadge";
import ServiceStatusTable from "@/components/ServiceStatusTable";
import type { OverallStatus, ServiceHealth } from "@/types";

function formatMs(ms: number): string {
  return `${Math.round(ms * 100) / 100} ms`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

const OVERALL_STYLES: Record<
  OverallStatus,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  healthy: {
    label: "All systems operational",
    className: "border-green-200 bg-green-50",
    Icon: CheckCircle2,
  },
  degraded: {
    label: "System degraded",
    className: "border-amber-200 bg-amber-50",
    Icon: AlertTriangle,
  },
  unhealthy: {
    label: "System unhealthy",
    className: "border-red-200 bg-red-50",
    Icon: XCircle,
  },
};

const SERVICE_ICONS: Record<string, typeof Database> = {
  postgres: Database,
  prisma: Database,
  ai: Cpu,
  storage: HardDrive,
  redis: Server,
};

function ServiceCard({ service }: { service: ServiceHealth }) {
  const Icon = SERVICE_ICONS[service.name] ?? Server;
  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <Icon className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{service.label}</p>
            <p className="text-xs text-gray-500 capitalize">{service.name}</p>
          </div>
        </div>
        <StatusBadge status={service.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <p className="text-xs text-gray-500">Response time</p>
          <p className="font-medium text-gray-800">{formatMs(service.responseTimeMs)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Version</p>
          <p className="font-medium text-gray-800">{service.version || "—"}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Last checked</p>
          <p className="font-medium text-gray-800">{formatTime(service.lastChecked)}</p>
        </div>
        {service.detail && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">Detail</p>
            <p className="font-medium text-gray-800 truncate" title={service.detail}>
              {service.detail}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="card animate-pulse space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gray-200" />
            <div className="space-y-1.5">
              <div className="h-3 w-24 rounded bg-gray-200" />
              <div className="h-2.5 w-16 rounded bg-gray-200" />
            </div>
            <div className="ml-auto h-5 w-20 rounded-full bg-gray-200" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="h-3 w-20 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SystemMonitoringPage() {
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const monitoringQuery = useQuery({
    queryKey: ["system", "monitoring"],
    queryFn: () => systemService.getMonitoring(),
    refetchInterval: autoRefresh ? 15000 : false,
  });

  useEffect(() => {
    if (monitoringQuery.dataUpdatedAt > 0) setLastRefreshed(new Date());
  }, [monitoringQuery.dataUpdatedAt]);

  const { data: monitoring, isLoading, isError, refetch, isFetching } = monitoringQuery;

  const overall = monitoring?.status ?? "degraded";
  const overallStyle = OVERALL_STYLES[overall] ?? OVERALL_STYLES.degraded;
  const OverallIcon = overallStyle.Icon;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
          <p className="mt-1 text-sm text-gray-500">
            Real-time status of every VigiLens service and dependency
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((value) => !value)}
            className="flex items-center gap-2 text-sm text-gray-600"
          >
            <span
              className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                autoRefresh ? "bg-brand-600" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  autoRefresh ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </span>
            Auto-refresh (15s)
          </button>
          {lastRefreshed && (
            <p className="text-xs text-gray-500">
              Last refreshed: {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {isError && (
        <div className="card flex flex-col items-center gap-3 border-red-200 bg-red-50 py-10 text-center">
          <AlertTriangle className="h-8 w-8 text-red-500" />
          <div>
            <p className="font-semibold text-red-700">Failed to load system status</p>
            <p className="mt-1 text-sm text-red-600">
              The monitoring service could not be reached.
            </p>
          </div>
          <button onClick={() => refetch()} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      {isLoading ? (
        <>
          <div className="card animate-pulse space-y-3 p-6">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-8 w-64 rounded bg-gray-200" />
            <div className="h-3 w-48 rounded bg-gray-200" />
          </div>
          <ServiceCardsSkeleton />
        </>
      ) : (
        monitoring && (
          <>
            <div className={`card border ${overallStyle.className}`}>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                    <OverallIcon className="h-8 w-8 text-gray-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Overall system status</p>
                    <p className="text-xl font-bold capitalize text-gray-900">{overall}</p>
                    <p className="text-sm text-gray-600">{overallStyle.label}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-6 text-sm">
                  <div>
                    <p className="text-xs text-gray-500">Version</p>
                    <p className="font-semibold text-gray-800">v{monitoring.version}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Uptime</p>
                    <p className="font-semibold text-gray-800">
                      {formatDuration(monitoring.uptime.process)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Checked at</p>
                    <p className="font-semibold text-gray-800">
                      {formatTime(monitoring.timestamp)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">Service Status</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {monitoring.services.map((service) => (
                <ServiceCard key={service.name} service={service} />
              ))}
            </div>
            <ServiceStatusTable services={monitoring.services} />
          </>
        )
      )}
    </div>
  );
}
