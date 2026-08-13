import type { Detection } from "@/types";
import { X, Download, Camera, Tag, Activity, Clock, AlertTriangle } from "lucide-react";

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
  if (!detection) return null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = detection.imageUrl;
    a.download = `detection-${detection.label.replace(/\s+/g, "-").toLowerCase()}.jpg`;
    a.target = "_blank";
    a.click();
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span>{statusIcons[detection.status]}</span>
            <h2 className="text-lg font-semibold text-gray-900">Detection Details</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div
            className="relative aspect-video rounded-xl overflow-hidden bg-gray-100 cursor-pointer group"
            onClick={() => onPreview(detection.imageUrl)}
          >
            <img
              src={detection.imageUrl}
              alt={detection.label}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <span className="text-white/0 group-hover:text-white/80 text-sm font-medium transition-all">
                Click to preview
              </span>
            </div>
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
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Download Snapshot
              </button>
              <button
                onClick={() => onPreview(detection.imageUrl)}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <AlertTriangle className="w-4 h-4" />
                View Full Image
              </button>
            </div>
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