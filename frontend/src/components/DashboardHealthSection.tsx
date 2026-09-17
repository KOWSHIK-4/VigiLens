import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Camera,
  ChevronRight,
  Cpu,
  Database,
  Radio,
  ShieldAlert,
  WifiOff,
} from "lucide-react";
import { cameraService } from "@/services/cameras";
import { detectorService } from "@/services/detectors";
import { incidentService } from "@/services/incidents";
import { systemService } from "@/services/system";
import { useAuth } from "@/hooks/useAuth";
import { hasPermission } from "@/utils/permissions";
import { formatRelativeTime } from "@/utils/format";

interface HealthTileProps {
  title: string;
  icon: ReactNode;
  linkTo?: string;
  state: "loading" | "ready" | "error" | "unavailable";
  headline: string;
  subline?: string;
  tone: "neutral" | "good" | "warn" | "bad";
  updatedAt?: number;
}

const TILE_TONES = {
  neutral: { dot: "bg-gray-400", ring: "border-gray-200", text: "text-gray-700" },
  good: { dot: "bg-emerald-500", ring: "border-emerald-200", text: "text-emerald-700" },
  warn: { dot: "bg-amber-500", ring: "border-amber-200", text: "text-amber-700" },
  bad: { dot: "bg-red-500", ring: "border-red-200", text: "text-red-700" },
} as const;

function HealthTile({
  title,
  icon,
  linkTo,
  state,
  headline,
  subline,
  tone,
  updatedAt,
}: HealthTileProps) {
  const tones = TILE_TONES[tone];

  const body = (
    <div
      className={`card p-4 flex flex-col gap-3 border ${tones.ring} h-full transition-all hover:shadow-md`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <span className="text-gray-400">{icon}</span>
          {title}
        </div>
        {state === "loading" && (
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300 animate-pulse" />
        )}
        {state === "ready" && (
          <span className={`h-2.5 w-2.5 rounded-full ${tones.dot}`} />
        )}
        {state === "error" && (
          <span className="h-2.5 w-2.5 rounded-full bg-red-400 animate-pulse" />
        )}
        {state === "unavailable" && (
          <span className="h-2.5 w-2.5 rounded-full bg-gray-300" />
        )}
      </div>

      {state === "loading" && (
        <div className="animate-pulse space-y-2">
          <div className="h-6 w-24 rounded bg-gray-200" />
          <div className="h-3 w-40 rounded bg-gray-200" />
        </div>
      )}

      {state === "error" && (
        <div className="text-sm text-red-600">
          <p className="font-medium">Unavailable right now</p>
          <p className="text-xs text-red-500 mt-0.5">Failed to load — check connection</p>
        </div>
      )}

      {state === "unavailable" && (
        <div className="text-sm text-gray-400">
          <p className="font-medium">Not available</p>
          <p className="text-xs mt-0.5">You don't have permission to view this</p>
        </div>
      )}

      {state === "ready" && (
        <div className="min-w-0">
          <p className={`text-xl font-bold ${tones.text} leading-tight`}>{headline}</p>
          {subline && <p className="text-xs text-gray-500 mt-1 truncate">{subline}</p>}
          {updatedAt !== undefined && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Updated {formatRelativeTime(new Date(updatedAt).toISOString())}
            </p>
          )}
        </div>
      )}
    </div>
  );

  if (linkTo && state !== "unavailable") {
    return (
      <Link
        to={linkTo}
        className="group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-xl"
      >
        {body}
      </Link>
    );
  }
  return body;
}

/**
 * Live operational overview for the main dashboard. Every metric comes from a
 * real, RBAC-gated API read — nothing is fabricated. Each tile distinguishes
 * the current value (ready), loading (pulse), and unavailable data (either a
 * failed request or a missing permission). The data windows shown are the
 * same ones the backend computes.
 */
export default function DashboardHealthSection({ autoRefresh }: { autoRefresh: boolean }) {
  const { user } = useAuth();
  const canSeeAlerts = hasPermission(user, "alerts.read");
  const canSeeCameras = hasPermission(user, "cameras.read");
  const canSeeDetectors = hasPermission(user, "models.read");
  const canSeeMonitoring = hasPermission(user, "monitoring.read");

  const incidents = useQuery({
    queryKey: ["incidents", "summary"],
    enabled: canSeeAlerts,
    queryFn: () => incidentService.getSummary(),
    refetchInterval: autoRefresh ? 60000 : false,
  });

  const cameras = useQuery({
    queryKey: ["cameras", "dashboard-health"],
    enabled: canSeeCameras,
    queryFn: () => cameraService.getAll({ limit: 100 }),
    refetchInterval: autoRefresh ? 60000 : false,
  });

  const detectors = useQuery({
    queryKey: ["detectors", "dashboard-health"],
    enabled: canSeeDetectors,
    queryFn: () => detectorService.getAll({ page: 1, limit: 100 }),
    refetchInterval: autoRefresh ? 60000 : false,
  });

  const system = useQuery({
    queryKey: ["system", "monitoring-dashboard"],
    enabled: canSeeMonitoring,
    queryFn: () => systemService.getMonitoring(),
    refetchInterval: autoRefresh ? 60000 : false,
  });

  const cameraList = cameras.data?.data ?? [];
  const cameraTally = {
    online: cameraList.filter((c) => c.status === "online").length,
    offline: cameraList.filter((c) => c.status === "offline" || c.status === "connecting").length,
    error: cameraList.filter((c) => c.status === "error").length,
  };
  const cameraTotal = cameraList.length;
  const cameraHealthy = cameraList.filter((c) => c.isHealthy).length;

  const detectorList = detectors.data?.data ?? [];
  const runningDetectors = detectorList.filter((d) => d.status === "running").length;
  const errorDetectors = detectorList.filter((d) => d.status === "error").length;
  const stoppedDetectors = detectorList.length - runningDetectors - errorDetectors;

  const aiService = system.data?.services.find((s) => s.name === "ai");

  return (
    <section aria-label="Operational status">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-brand-600" />
          Operational Status
        </h2>
        {system.error && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
            <WifiOff className="w-3.5 h-3.5" />
            Some status feeds unavailable
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        <HealthTile
          title="Incidents"
          icon={<ShieldAlert className="w-4 h-4" />}
          linkTo={canSeeAlerts ? "/incidents" : undefined}
          state={!canSeeAlerts ? "unavailable" : incidents.isLoading ? "loading" : incidents.isError ? "error" : "ready"}
          tone={(incidents.data?.open ?? 0) > 0 ? "bad" : "good"}
          headline={
            incidents.data
              ? `${incidents.data.open} open · ${incidents.data.resolved} resolved`
              : "—"
          }
          subline={
            incidents.data && incidents.data.open > 0
              ? `${incidents.data.open} incident${incidents.data.open === 1 ? "" : "s"} need attention`
              : "No open incidents"
          }
          updatedAt={incidents.dataUpdatedAt}
        />

        <HealthTile
          title="Cameras"
          icon={<Camera className="w-4 h-4" />}
          linkTo={canSeeCameras ? "/cameras" : undefined}
          state={!canSeeCameras ? "unavailable" : cameras.isLoading ? "loading" : cameras.isError ? "error" : "ready"}
          tone={cameraTotal > 0 && cameraTally.error === 0 ? (cameraTally.offline > 0 ? "warn" : "good") : "neutral"}
          headline={cameras.data ? `${cameraHealthy}/${cameraTotal} healthy` : "—"}
          subline={
            cameras.data
              ? `${cameraTally.online} online · ${cameraTally.offline} offline · ${cameraTally.error} error`
              : "—"
          }
          updatedAt={cameras.dataUpdatedAt}
        />

        <HealthTile
          title="Detectors"
          icon={<Cpu className="w-4 h-4" />}
          linkTo={canSeeDetectors ? "/detectors" : undefined}
          state={!canSeeDetectors ? "unavailable" : detectors.isLoading ? "loading" : detectors.isError ? "error" : "ready"}
          tone={errorDetectors > 0 ? "bad" : runningDetectors > 0 ? "good" : "neutral"}
          headline={detectors.data ? `${runningDetectors} running` : "—"}
          subline={
            detectors.data
              ? `${detectorList.length} installed · ${errorDetectors} error · ${stoppedDetectors} stopped`
              : "—"
          }
          updatedAt={detectors.dataUpdatedAt}
        />

        <HealthTile
          title="AI Service"
          icon={<Radio className="w-4 h-4" />}
          state={!canSeeMonitoring ? "unavailable" : system.isLoading ? "loading" : system.isError ? "error" : "ready"}
          tone={!aiService ? "neutral" : aiService.status === "healthy" ? "good" : aiService.status === "degraded" ? "warn" : "bad"}
          headline={
            aiService
              ? aiService.status === "healthy"
                ? "Healthy"
                : aiService.status === "degraded"
                  ? "Degraded"
                  : "Offline"
              : "—"
          }
          subline={aiService?.detail ? `${aiService.detail}` : undefined}
          updatedAt={system.dataUpdatedAt}
        />

        <HealthTile
          title="Scheduler"
          icon={<Database className="w-4 h-4" />}
          linkTo={canSeeMonitoring ? "/monitoring" : undefined}
          state={!canSeeMonitoring ? "unavailable" : system.isLoading ? "loading" : system.isError ? "error" : "ready"}
          tone={system.data?.scheduler?.running ? "good" : "warn"}
          headline={
            system.data
              ? system.data.scheduler?.running
                ? `${system.data.scheduler.loopCount} loops running`
                : "Paused"
              : "—"
          }
          subline={
            system.data
              ? system.data.scheduler?.running
                ? `${system.data.scheduler.detectionsCreated} detections via scheduler`
                : "Monitoring is stopped"
              : "—"
          }
          updatedAt={system.dataUpdatedAt}
        />
      </div>

      {system.data?.services && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <AlertTriangle className="w-3.5 h-3.5 text-gray-400" />
          Service checks:
          {system.data.services.map((service) => (
            <span
              key={service.name}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-gray-200 bg-white"
              title={service.detail ?? service.label}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  service.status === "healthy"
                    ? "bg-emerald-500"
                    : service.status === "degraded"
                      ? "bg-amber-500"
                      : "bg-red-500"
                }`}
              />
              {service.label}
            </span>
          ))}
          {system.data.scheduler?.running && (
            <Link
              to="/monitoring"
              className="ml-auto inline-flex items-center gap-1 text-brand-700 hover:text-brand-800 font-medium"
            >
              View monitoring
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}