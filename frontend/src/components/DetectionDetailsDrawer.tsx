import type { Detection } from "@/types";
import { X, Download, Camera, Tag, Activity, Clock, AlertTriangle, Box, Cpu, Hash } from "lucide-react";
import { useEffect, useRef } from "react";
import DetectionSnapshot from "./DetectionSnapshot";
import { downloadDetectionImage } from "@/utils/detectionImage";
import { showToast } from "@/utils/toast";

interface DetectionDetailsDrawerProps {
  detection: Detection | null;
  onClose: () => void;
  onPreview: (src: string) => void;
}

const statusColors = {
  critical: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  info: "bg-blue-100 text-blue-800 border-blue-200",
};

const statusIcons = {
  critical: "🔴",
  warning: "🟡",
  info: "🔵",
};

export default function DetectionDetailsDrawer({ detection, onClose, onPreview }: DetectionDetailsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!detection) return;
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
  }, [detection, onClose]);

  if (!detection) return null;

  const hasSnapshot = Boolean(detection.imageUrl);

  const handleDownload = async () => {
    try {
      const ok = await downloadDetectionImage(detection.imageUrl, detection.label);
      if (!ok) {
        showToast({
          severity: "info",
          title: "No snapshot",
          message: "No snapshot was captured for this detection.",
        });
      }
    } catch (err) {
      console.error("Failed to download snapshot:", err);
      showToast({
        severity: "critical",
        title: "Download failed",
        message: "Could not download the snapshot. Please try again.",
      });
    }
  };

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
        aria-label="Detection details"
        className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto drawer-enter"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span>{statusIcons[detection.status]}</span>
            <h2 className="text-lg font-semibold text-gray-900">Detection Details</h2>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close detection details"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div
            className={`relative aspect-video rounded-xl overflow-hidden bg-gray-100 ${
              hasSnapshot ? "cursor-pointer group" : ""
            }`}
            onClick={() => hasSnapshot && onPreview(detection.imageUrl)}
          >
            <DetectionSnapshot imageUrl={detection.imageUrl} alt={detection.label} />
            {hasSnapshot && (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                <span className="text-white/0 group-hover:text-white/80 text-sm font-medium transition-all">
                  Click to preview
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <DetailItem
              icon={<Tag className="w-4 h-4" />}
              label="Label"
              value={detection.label}
            />
            <DetailItem
              icon={<Camera className="w-4 h-4" />}
              label="Camera"
              value={detection.camera?.name ?? "—"}
            />
            <DetailItem
              icon={<Activity className="w-4 h-4" />}
              label="Confidence"
              value={`${(detection.confidence * 100).toFixed(1)}%`}
            />
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Status</p>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColors[detection.status]}`}>
                {statusIcons[detection.status]} {detection.status}
              </span>
            </div>
            {detection.detectorKey && (
              <DetailItem
                icon={<Cpu className="w-4 h-4" />}
                label="Detector"
                value={detection.detectorKey}
              />
            )}
            {detection.trackId && (
              <DetailItem
                icon={<Hash className="w-4 h-4" />}
                label="Track ID"
                value={detection.trackId}
              />
            )}
            {detection.processingTimeMs != null && (
              <DetailItem
                icon={<Activity className="w-4 h-4" />}
                label="Inference"
                value={`${detection.processingTimeMs.toFixed(1)} ms`}
              />
            )}
            {detection.boundingBox && (
              <DetailItem
                icon={<Box className="w-4 h-4" />}
                label="Bounding Box"
                value={`(${detection.boundingBox.x1}, ${detection.boundingBox.y1}) → (${detection.boundingBox.x2}, ${detection.boundingBox.y2})`}
              />
            )}
            <div className="col-span-2">
              <DetailItem
                icon={<Clock className="w-4 h-4" />}
                label="Timestamp"
                value={new Date(detection.timestamp).toLocaleString()}
              />
            </div>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Actions</h3>
            <div className="flex gap-3">
              <button
                onClick={handleDownload}
                disabled={!hasSnapshot}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Download Snapshot
              </button>
              <button
                onClick={() => onPreview(detection.imageUrl)}
                disabled={!hasSnapshot}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <AlertTriangle className="w-4 h-4" />
                View Full Image
              </button>
            </div>
            {!hasSnapshot && (
              <p className="text-xs text-gray-400 mt-2">
                No snapshot was captured for this detection.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-1.5 text-sm text-gray-900">
        {icon}
        <span className="font-medium">{value}</span>
      </div>
    </div>
  );
}