import type { Detection } from "@/types";
import DetectionSnapshot from "./DetectionSnapshot";
import { getSeverityStyle } from "@/utils/statusConfig";
import { formatRelativeTime } from "@/utils/format";
import { ChevronRight } from "lucide-react";

interface DetectionCardProps {
  detection: Detection;
  onSelect?: () => void;
}

export default function DetectionCard({ detection, onSelect }: DetectionCardProps) {
  const style = getSeverityStyle(detection.status);
  const clickable = Boolean(onSelect);

  return (
    <button
      type="button"
      onClick={onSelect}
      tabIndex={clickable ? 0 : -1}
      className={`card flex items-start gap-4 text-left w-full ${
        clickable
          ? "hover:border-gray-300 hover:shadow-md transition-all cursor-pointer group"
          : ""
      }`}
    >
      <div className="w-20 h-20 rounded-lg flex-shrink-0 overflow-hidden bg-gray-100">
        <DetectionSnapshot imageUrl={detection.imageUrl} alt={detection.label} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${style.badge} uppercase tracking-wide`}
          >
            {detection.status}
          </span>
          <span className="text-sm text-gray-500 truncate">
            {detection.camera?.name ?? "Unknown source"}
          </span>
          <span className="ml-auto text-xs text-gray-400 flex-shrink-0">
            {formatRelativeTime(detection.timestamp)}
          </span>
        </div>

        <p className="font-medium text-gray-900 truncate mt-1">{detection.label}</p>

        <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500">
          <span className="flex items-center gap-1.5 flex-shrink-0">
            Confidence: {(detection.confidence * 100).toFixed(1)}%
          </span>
          <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden flex-shrink-0">
            <div
              className={`h-full rounded-full ${
                detection.confidence >= 0.8
                  ? "bg-green-500"
                  : detection.confidence >= 0.5
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${Math.min(100, detection.confidence * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {clickable && (
        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0 self-center transition-colors" />
      )}
    </button>
  );
}