import { useQuery } from "@tanstack/react-query";
import {
  X,
  Gauge,
  BellRing,
  Clock,
  Cpu,
  FolderOpen,
  KeyRound,
  Tag,
  Camera,
  Activity,
  HeartPulse,
  Layers,
  RefreshCw,
  Settings,
  Download,
} from "lucide-react";
import { detectorService } from "@/services/detectors";
import { engineService } from "@/services/engine";
import type { MarketplaceDetector } from "@/types";
import DetectorIcon from "./DetectorIcon";
import DetectorStatusBadge from "./DetectorStatusBadge";
import DetectorAvailabilityBadge from "./DetectorAvailabilityBadge";

interface DetectorDetailsDrawerProps {
  detector: MarketplaceDetector | null;
  onClose: () => void;
  onConfigure: (detector: MarketplaceDetector) => void;
  onCameras: (detector: MarketplaceDetector) => void;
  onRestart: (detector: MarketplaceDetector) => void;
}

function formatInterval(ms: number | null): string {
  if (!ms) return "—";
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return `${seconds}s`;
  const hours = Math.floor(mins / 60);
  if (hours < 1) return `${mins}m`;
  return `${hours}h ${mins % 60}m`;
}

export default function DetectorDetailsDrawer({
  detector,
  onClose,
  onConfigure,
  onCameras,
  onRestart,
}: DetectorDetailsDrawerProps) {
  const isInstalled = Boolean(detector?.installed && detector?.id);

  const { data: health } = useQuery({
    queryKey: ["detectors", detector?.id, "health"],
    queryFn: () => detectorService.health(detector!.id!),
    enabled: isInstalled,
    refetchInterval: 5000,
  });

  const { data: detail } = useQuery({
    queryKey: ["detectors", detector?.id],
    queryFn: () => detectorService.getById(detector!.id!),
    enabled: isInstalled,
  });

  const { data: engineDescriptor } = useQuery({
    queryKey: ["detectors", "engine", detector?.key],
    queryFn: () => engineService.getByKey(detector!.key),
    enabled: Boolean(detector?.key),
    refetchInterval: 5000,
  });

  const { data: engineMetrics } = useQuery({
    queryKey: ["detectors", "engine", detector?.key, "metrics"],
    queryFn: () => engineService.getMetrics(detector!.key),
    enabled: Boolean(detector?.key),
    refetchInterval: 5000,
  });

  const hasRealMetrics =
    engineMetrics && "recorded" in engineMetrics ? false : Boolean(engineMetrics?.framesProcessed);

  if (!detector) return null;

  const installed = detector.installed && detector.id;
  const cameras = detail?.cameras ?? [];

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
              <DetectorIcon icon={detector.icon} className="w-5 h-5 text-brand-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {detector.name}
              </h2>
              <p className="text-xs text-gray-500">
                v{detector.version} · {detector.category}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col items-start gap-1.5">
              {installed && detector.status ? (
                <DetectorStatusBadge status={detector.status} />
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                  <Download className="w-3.5 h-3.5" />
                  Not installed
                </span>
              )}
              {engineDescriptor && (
                <DetectorAvailabilityBadge availability={engineDescriptor.availability} />
              )}
            </div>
            {installed && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                  detector.enabled
                    ? "bg-green-50 text-green-700 border border-green-200"
                    : "bg-gray-100 text-gray-500 border border-gray-200"
                }`}
              >
                {detector.enabled ? "Enabled" : "Disabled"}
              </span>
            )}
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5">
              Description
            </p>
            <p className="text-sm text-gray-700 leading-relaxed">
              {detector.description}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <DetailItem
              icon={<Gauge className="w-4 h-4" />}
              label="Confidence Threshold"
              value={`${detector.confidenceThreshold ?? detector.defaultConfidenceThreshold}%`}
            />
            <DetailItem
              icon={<BellRing className="w-4 h-4" />}
              label="Alert Severity"
              value={detector.alertSeverity ? detector.alertSeverity : "—"}
            />
            <DetailItem
              icon={<Clock className="w-4 h-4" />}
              label="Detection Interval"
              value={formatInterval(detector.detectionIntervalMs)}
            />
            <DetailItem
              icon={<Cpu className="w-4 h-4" />}
              label="Processor"
              value={detector.preferredProcessor
                ? detector.preferredProcessor.toUpperCase()
                : detector.gpuSupported
                  ? "GPU"
                  : "CPU"}
            />
            <DetailItem
              icon={<KeyRound className="w-4 h-4" />}
              label="Detector Key"
              value={detector.key}
            />
            <DetailItem
              icon={<Tag className="w-4 h-4" />}
              label="GPU Support"
              value={detector.gpuSupported ? "Supported" : "CPU only"}
            />
            <div className="col-span-2">
              <DetailItem
                icon={<FolderOpen className="w-4 h-4" />}
                label="Model Path"
                value={detector.modelPath}
              />
            </div>
            <DetailItem
              icon={<Camera className="w-4 h-4" />}
              label="Assigned Cameras"
              value={String(detector.cameraCount ?? 0)}
            />
            <DetailItem
              icon={<Activity className="w-4 h-4" />}
              label="Inference Time"
              value={`~${detector.inferenceTimeMs}ms`}
            />
          </div>

          {installed && health && (
            <div className="card bg-gray-50 border border-gray-100">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3">
                <HeartPulse className="w-4 h-4 text-brand-600" />
                Detector Health
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-500">Status</p>
                  <p
                    className={`text-sm font-semibold ${
                      health.healthy ? "text-green-600" : "text-amber-600"
                    }`}
                  >
                    {health.healthy ? "Healthy" : health.status === "error" ? "Unhealthy" : "Idle"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Latency</p>
                  <p className="text-sm font-semibold text-gray-900">{health.latencyMs}ms</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Uptime</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatUptime(health.uptimeSeconds)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Throughput</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {health.throughputFps} fps
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Frames Processed</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {health.framesProcessed.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Monitored Cameras</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {health.assignedCameras}
                  </p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3">{health.message}</p>
            </div>
          )}

          {installed && (
            <div className="card bg-gray-50 border border-gray-100">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 mb-3">
                <Activity className="w-4 h-4 text-brand-600" />
                Engine Performance
              </h3>
              {hasRealMetrics ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">Total Processing</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {engineMetrics?.totalProcessingTimeMs ?? 0}ms
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Inference</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {engineMetrics?.inferenceTimeMs ?? 0}ms
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Tracking</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {engineMetrics?.trackingTimeMs ?? 0}ms
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Frames Processed</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {engineMetrics?.framesProcessed ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Detections / Frame</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {engineMetrics?.detectionsPerFrame ?? 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Errors</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {engineMetrics?.errorCount ?? 0}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400">
                  No engine runs recorded yet. Run a detection to measure real inference
                  performance.
                </p>
              )}
            </div>
          )}

          {installed && detector.cameraCount ? (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                Monitored Cameras
              </p>
              <div className="space-y-1.5">
                {cameras.length === 0
                  ? Array.from({ length: Math.min(detector.cameraCount, 4) }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2"
                      >
                        <Camera className="w-4 h-4 text-gray-400" />
                        Camera assignment {i + 1}
                      </div>
                    ))
                  : cameras.map((cam) => (
                      <div
                        key={cam.id}
                        className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2"
                      >
                        <Camera className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <span className="truncate">{cam.name}</span>
                      </div>
                    ))}
                {detector.cameraCount > 4 && cameras.length === 0 && (
                  <p className="text-xs text-gray-400">
                    +{detector.cameraCount - 4} more
                  </p>
                )}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-2">
            {installed ? (
              <>
                <button
                  onClick={() => onConfigure(detector)}
                  className="btn-primary inline-flex items-center gap-2 text-sm flex-1 justify-center"
                >
                  <Settings className="w-4 h-4" />
                  Configure
                </button>
                <button
                  onClick={() => onCameras(detector)}
                  className="btn-secondary inline-flex items-center gap-2 text-sm flex-1 justify-center"
                >
                  <Camera className="w-4 h-4" />
                  Cameras
                </button>
                <button
                  onClick={() => onRestart(detector)}
                  disabled={!detector.enabled}
                  className="btn-secondary inline-flex items-center gap-2 text-sm flex-1 justify-center disabled:opacity-40"
                >
                  <RefreshCw className="w-4 h-4" />
                  Restart
                </button>
              </>
            ) : (
              <div className="flex items-center gap-1 text-sm text-gray-400">
                <Layers className="w-4 h-4" />
                Install this detector to configure it.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="flex items-center gap-1.5 text-sm text-gray-900 break-all">
        {icon}
        <span className="font-medium capitalize">{value}</span>
      </div>
    </div>
  );
}
