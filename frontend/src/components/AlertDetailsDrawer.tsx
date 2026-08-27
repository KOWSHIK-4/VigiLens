import { useEffect, useRef } from "react";
import { Camera, Clock, ShieldAlert, X } from "lucide-react";
import { getSeverityStyle } from "@/utils/statusConfig";
import { formatDateTime } from "@/utils/format";
import type { Alert, DetectionWithCamera } from "@/types";

interface AlertDetailsDrawerProps {
  alert: Alert | null;
  onClose: () => void;
  onViewDetection?: (detection: DetectionWithCamera) => void;
}

export default function AlertDetailsDrawer({
  alert,
  onClose,
  onViewDetection,
}: AlertDetailsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!alert) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [alert, onClose]);

  if (!alert) return null;

  const style = getSeverityStyle(alert.severity);
  const Icon = style.icon;
  const detection = alert.detection ?? null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Alert details"
        className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto drawer-enter"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${style.iconColor}`} />
            <h2 className="text-lg font-semibold text-gray-900">
              Alert Details
            </h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close alert details"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className={`border rounded-xl p-4 ${style.bg}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${style.badge}`}
              >
                {style.label}
              </span>
              <span
                className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  alert.isRead
                    ? "bg-gray-100 text-gray-600 border-gray-200"
                    : "bg-brand-50 text-brand-700 border-brand-200"
                }`}
              >
                {alert.isRead ? "Read" : "New"}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mt-3 leading-snug">
              {alert.title}
            </h3>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">
              {alert.message}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <DetailItem
              icon={<Clock className="w-4 h-4" />}
              label="Timestamp"
              value={formatDateTime(alert.createdAt)}
              full
            />
            {detection?.camera && (
              <DetailItem
                icon={<Camera className="w-4 h-4" />}
                label="Source"
                value={
                  detection.camera.location
                    ? `${detection.camera.name} — ${detection.camera.location}`
                    : detection.camera.name
                }
                full
              />
            )}
          </div>

          {detection && (
            <>
              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-medium text-gray-900 mb-3">
                  Related Detection
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem label="Event" value={detection.label} />
                  <DetailItem
                    label="Confidence"
                    value={`${(detection.confidence * 100).toFixed(1)}%`}
                  />
                  <DetailItem
                    label="Severity"
                    value={detection.status}
                  />
                  <DetailItem
                    label="Timestamp"
                    value={formatDateTime(detection.timestamp)}
                  />
                </div>
                {onViewDetection && (
                  <button
                    onClick={() => onViewDetection(detection)}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    View detection details
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function DetailItem({
  icon,
  label,
  value,
  full = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <div className="flex items-center gap-1.5 text-sm text-gray-900">
        {icon}
        <span className="font-medium break-words">{value}</span>
      </div>
    </div>
  );
}