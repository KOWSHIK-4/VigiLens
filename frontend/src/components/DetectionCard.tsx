import type { Detection } from "@/types";
import DetectionSnapshot from "./DetectionSnapshot";

const statusColors = {
  critical: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
  info: "bg-blue-100 text-blue-800 border-blue-200",
};

export default function DetectionCard({ detection }: { detection: Detection }) {
  return (
    <div className="card flex items-start gap-4">
      <div className="w-20 h-20 rounded-lg flex-shrink-0 overflow-hidden">
        <DetectionSnapshot imageUrl={detection.imageUrl} alt={detection.label} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${statusColors[detection.status]}`}
          >
            {detection.status}
          </span>
          <span className="text-sm text-gray-500">{detection.camera?.name ?? "—"}</span>
        </div>

        <p className="font-medium text-gray-900 truncate">{detection.label}</p>

        <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
          <span>Confidence: {(detection.confidence * 100).toFixed(1)}%</span>
          <span>{new Date(detection.timestamp).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
