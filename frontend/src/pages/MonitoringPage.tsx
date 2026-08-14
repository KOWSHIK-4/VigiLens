import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { monitoringService } from "@/services/monitoring";
import { hasPermission } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import { showToast } from "@/utils/toast";
import type { MonitorLoop, MonitorLoopStatus } from "@/types";

const LOOP_STATUS_STYLES: Record<
  MonitorLoopStatus,
  { label: string; className: string; Icon: typeof Clock }
> = {
  idle: { label: "Idle", className: "bg-gray-100 text-gray-600", Icon: Clock },
  running: { label: "Running", className: "bg-blue-100 text-blue-700", Icon: Loader2 },
  ok: { label: "OK", className: "bg-green-100 text-green-700", Icon: CheckCircle2 },
  error: { label: "Error", className: "bg-red-100 text-red-700", Icon: XCircle },
  skipped: { label: "Skipped", className: "bg-gray-100 text-gray-600", Icon: Clock },
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${ms} ms`;
}

function formatInterval(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  if (ms >= 1_000) return `${Math.round(ms / 1_000)}s`;
  return `${ms}ms`;
}

function LoopBadge({ status }: { status: MonitorLoopStatus }) {
  const style = LOOP_STATUS_STYLES[status] ?? LOOP_STATUS_STYLES.idle;
  const Icon = style.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
}

export default function MonitoringPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = hasPermission(user, "monitoring.manage");

  const statusQuery = useQuery({
    queryKey: ["monitor", "status"],
    queryFn: () => monitoringService.getStatus(),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 15000),
  });

  const startMutation = useMutation({
    mutationFn: () => monitoringService.start(),
    onSuccess: (status) => {
      queryClient.setQueryData(["monitor", "status"], status);
      showToast({ severity: "info", title: "Monitoring started", message: "Continuous monitoring scheduler is now running." });
    },
    onError: () => {
      showToast({ severity: "warning", title: "Start failed", message: "Could not start the monitoring scheduler." });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => monitoringService.stop(),
    onSuccess: (status) => {
      queryClient.setQueryData(["monitor", "status"], status);
      showToast({ severity: "info", title: "Monitoring stopped", message: "Continuous monitoring scheduler stopped." });
    },
    onError: () => {
      showToast({ severity: "warning", title: "Stop failed", message: "Could not stop the monitoring scheduler." });
    },
  });

  const { data: status, isLoading, isError, refetch, isFetching } = statusQuery;

  const busy = startMutation.isPending || stopMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Continuous Monitoring</h1>
          <p className="mt-1 text-sm text-gray-500">
            Run the inference engine automatically on assigned cameras at each
            detector's detection interval
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {canManage && status && (
            status.running ? (
              <button
                onClick={() => stopMutation.mutate()}
                disabled={busy}
                className="btn-secondary inline-flex items-center gap-2"
              >
                <PauseCircle className="h-4 w-4" />
                Stop Monitoring
              </button>
            ) : (
              <button
                onClick={() => startMutation.mutate()}
                disabled={busy}
                className="btn inline-flex items-center gap-2"
              >
                <PlayCircle className="h-4 w-4" />
                Start Monitoring
              </button>
            )
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
            <p className="font-semibold text-red-700">Failed to load monitoring status</p>
            <p className="mt-1 text-sm text-red-600">
              The monitoring endpoint could not be reached.
            </p>
          </div>
          <button onClick={() => refetch()} className="btn-secondary">
            Try again
          </button>
        </div>
      )}

      {isLoading && !status ? (
        <div className="card animate-pulse space-y-3 p-6">
          <div className="h-4 w-40 rounded bg-gray-200" />
          <div className="h-8 w-64 rounded bg-gray-200" />
          <div className="h-3 w-48 rounded bg-gray-200" />
        </div>
      ) : (
        status && (
          <>
            <div
              className={`card flex flex-col gap-4 border sm:flex-row sm:items-center sm:justify-between ${
                status.running ? "border-green-200 bg-green-50" : "border-gray-200 bg-gray-50"
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm">
                  <Activity className="h-8 w-8 text-gray-700" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Scheduler status</p>
                  <p className="text-xl font-bold capitalize text-gray-900">
                    {status.running ? "Running" : "Stopped"}
                  </p>
                  <p className="text-sm text-gray-600">
                    {status.running
                      ? `Started ${formatTime(status.startedAt)}`
                      : status.startedAt
                        ? `Stopped ${formatTime(status.stoppedAt)}`
                        : "Not started yet"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-gray-500">Loops</p>
                  <p className="font-semibold text-gray-800">{status.loopCount}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Frames processed</p>
                  <p className="font-semibold text-gray-800">{status.framesProcessed}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Detections</p>
                  <p className="font-semibold text-gray-800">{status.detectionsCreated}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Errors</p>
                  <p className="font-semibold text-gray-800">{status.errorCount}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-gray-500" />
              <h2 className="text-lg font-semibold text-gray-900">Detector Loops</h2>
              <p className="text-xs text-gray-500">
                Tick every {formatInterval(status.tickMs)}
                {status.nextTickAt ? ` · next tick ${formatTime(status.nextTickAt)}` : ""}
              </p>
            </div>

            {status.loops.length === 0 ? (
              <div className="card flex flex-col items-center gap-3 py-10 text-center">
                <Clock className="h-8 w-8 text-gray-300" />
                <div>
                  <p className="font-semibold text-gray-700">No monitoring loops configured</p>
                  <p className="mt-1 text-sm text-gray-500">
                    Assign cameras to an enabled, loaded detector to start continuous monitoring.
                  </p>
                </div>
              </div>
            ) : (
              <div className="card overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Detector</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Camera</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Interval</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Frames</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Detections</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Last run</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Latency</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Failures</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {status.loops.map((loop: MonitorLoop) => (
                      <tr key={loop.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-800">{loop.detectorName}</p>
                          <p className="text-xs text-gray-500">{loop.detectorKey}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-800">{loop.camera.name}</p>
                          <p className="max-w-[220px] truncate text-xs text-gray-500" title={loop.camera.url}>
                            {loop.camera.cameraType} · {loop.camera.url}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{formatInterval(loop.intervalMs)}</td>
                        <td className="px-4 py-3">
                          <LoopBadge status={loop.status} />
                        </td>
                        <td className="px-4 py-3 text-gray-700">{loop.framesProcessed}</td>
                        <td className="px-4 py-3 text-gray-700">{loop.detectionsCreated}</td>
                        <td className="px-4 py-3 text-gray-700">{formatTime(loop.lastRunAt)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatDuration(loop.lastProcessingTimeMs)}</td>
                        <td className="px-4 py-3">
                          <span className={loop.consecutiveFailures > 0 ? "font-semibold text-red-600" : "text-gray-700"}>
                            {loop.consecutiveFailures}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {status.loops.some((loop) => loop.lastError) && (
              <div className="card border-amber-200 bg-amber-50">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <h3 className="text-sm font-semibold text-amber-800">Recent loop errors</h3>
                </div>
                <ul className="mt-2 space-y-1.5 text-sm text-amber-700">
                  {status.loops
                    .filter((loop) => loop.lastError)
                    .map((loop) => (
                      <li key={loop.id}>
                        <span className="font-medium">{loop.camera.name}</span> · {loop.lastError}
                        {loop.lastErrorAt ? ` (${formatTime(loop.lastErrorAt)})` : ""}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
