import {
  Camera,
  ChevronRight,
  Clock,
  Download,
  Gauge,
  PencilLine,
  RefreshCw,
  Settings,
  Cpu,
  AlertTriangle,
  Tag,
} from "lucide-react";
import type { DetectorAvailability, DetectorEngineType, MarketplaceDetector } from "@/types";
import DetectorIcon from "./DetectorIcon";
import DetectorStatusBadge from "./DetectorStatusBadge";
import DetectorAvailabilityBadge from "./DetectorAvailabilityBadge";
import DetectorRuntimeStatusBadge from "./DetectorRuntimeStatusBadge";

interface DetectorCardProps {
  detector: MarketplaceDetector;
  busy?: boolean;
  canManage?: boolean;
  availability?: DetectorAvailability;
  engineType?: DetectorEngineType;
  onToggle: (detector: MarketplaceDetector) => void;
  onInstall: (detector: MarketplaceDetector) => void;
  onConfigure: (detector: MarketplaceDetector) => void;
  onCameras: (detector: MarketplaceDetector) => void;
  onEdit: (detector: MarketplaceDetector) => void;
  onRestart: (detector: MarketplaceDetector) => void;
  onDetails: (detector: MarketplaceDetector) => void;
}

function severityBadge(severity: MarketplaceDetector["alertSeverity"] | null) {
  if (!severity) return null;
  const map: Record<string, string> = {
    info: "bg-blue-50 text-blue-700 border border-blue-200",
    warning: "bg-amber-50 text-amber-700 border border-amber-200",
    critical: "bg-red-50 text-red-700 border border-red-200",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium capitalize ${map[severity]}`}
    >
      <AlertTriangle className="w-3 h-3" />
      {severity}
    </span>
  );
}

export default function DetectorCard({
  detector,
  busy,
  canManage = true,
  availability,
  engineType,
  onToggle,
  onInstall,
  onConfigure,
  onCameras,
  onEdit,
  onRestart,
  onDetails,
}: DetectorCardProps) {
  const isInstalled = detector.installed;
  const enabled = Boolean(detector.enabled);
  const type = detector.type ?? engineType;
  const interval = detector.detectionIntervalMs
    ? detector.detectionIntervalMs < 1000
      ? `${detector.detectionIntervalMs}ms`
      : `${Math.round(detector.detectionIntervalMs / 1000)}s`
    : null;
  const cooldown = detector.alertCooldownMs
    ? detector.alertCooldownMs < 1000
      ? `${detector.alertCooldownMs}ms`
      : `${Math.round(detector.alertCooldownMs / 1000)}s`
    : null;

  return (
    <div className="card flex flex-col transition-shadow hover:shadow-md group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              isInstalled ? "bg-brand-50" : "bg-gray-100"
            }`}
          >
            <DetectorIcon
              icon={detector.icon}
              className={`w-6 h-6 ${isInstalled ? "text-brand-600" : "text-gray-400"}`}
            />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{detector.name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">
                <Tag className="w-3 h-3" />
                {detector.category}
              </span>
              <span className="text-xs text-gray-400 font-mono">v{detector.version}</span>
            </div>
          </div>
        </div>
        {isInstalled && detector.runtimeStatus ? (
          <div className="flex flex-col items-end gap-1.5">
            <DetectorRuntimeStatusBadge status={detector.runtimeStatus} />
            {availability && <DetectorAvailabilityBadge availability={availability} />}
          </div>
        ) : isInstalled && detector.status ? (
          <div className="flex flex-col items-end gap-1.5">
            <DetectorStatusBadge status={detector.status} />
            {availability && <DetectorAvailabilityBadge availability={availability} />}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
            <Download className="w-3.5 h-3.5" />
            Available
          </span>
        )}
      </div>

      <p className="text-sm text-gray-500 leading-relaxed mt-3 line-clamp-2 min-h-[40px]">
        {detector.description}
      </p>

      {isInstalled ? (
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <Gauge className="w-3 h-3" />
            {detector.confidenceThreshold ?? detector.defaultConfidenceThreshold}%
          </span>
          {severityBadge(detector.alertSeverity)}
          {interval && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              <Clock className="w-3 h-3" />
              {interval}
            </span>
          )}
          {cooldown && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              <Clock className="w-3 h-3" />
              Alert {cooldown}
            </span>
          )}
          {detector.preferredProcessor && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
              <Cpu className="w-3 h-3" />
              {detector.preferredProcessor.toUpperCase()}
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <Camera className="w-3 h-3" />
            {detector.cameraCount} cam
          </span>
          {type && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
              <Cpu className="w-3 h-3" />
              {type.replace("_", " ")}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <Gauge className="w-3 h-3" />
            {detector.defaultConfidenceThreshold}%
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
            <Cpu className="w-3 h-3" />
            {detector.gpuSupported ? "GPU ready" : "CPU only"}
          </span>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-2">
        {isInstalled ? (
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => onToggle(detector)}
            disabled={busy || !canManage}
            aria-label={`${enabled ? "Disable" : "Enable"} ${detector.name}`}
            title={canManage ? undefined : "You don’t have permission to change detectors"}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
              enabled ? "bg-brand-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          </button>
        ) : (
          <button
            onClick={() => onInstall(detector)}
            disabled={busy || !canManage}
            className="btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Install
          </button>
        )}

        {isInstalled ? (
          <div className="flex items-center gap-1">
            {canManage && (
              <>
                <button
                  onClick={() => onConfigure(detector)}
                  disabled={busy}
                  className="p-2 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-40"
                  aria-label={`Configure ${detector.name}`}
                  title="Configure"
                >
                  <Settings className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onCameras(detector)}
                  disabled={busy}
                  className="p-2 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-40"
                  aria-label={`Assign cameras to ${detector.name}`}
                  title="Assign cameras"
                >
                  <Camera className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onEdit(detector)}
                  disabled={busy}
                  className="p-2 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-40"
                  aria-label={`Edit ${detector.name}`}
                  title="Edit"
                >
                  <PencilLine className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onRestart(detector)}
                  disabled={busy || !enabled}
                  className="p-2 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors disabled:opacity-40"
                  aria-label={`Restart ${detector.name}`}
                  title="Restart"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </>
            )}
            <button
              onClick={() => onDetails(detector)}
              className="p-2 rounded-lg text-gray-500 hover:text-brand-600 hover:bg-brand-50 transition-colors"
              aria-label={`View ${detector.name} details`}
              title="Details"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onDetails(detector)}
            className="text-sm font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-0.5"
          >
            Details
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
