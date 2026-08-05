import { CheckCircle2, Power, XCircle } from "lucide-react";
import type { DetectorStatus } from "@/types";

const statusConfig: Record<
  DetectorStatus,
  { label: string; bg: string; icon: typeof CheckCircle2 }
> = {
  running: {
    label: "Running",
    bg: "bg-green-100 text-green-700 border border-green-200",
    icon: CheckCircle2,
  },
  stopped: {
    label: "Stopped",
    bg: "bg-gray-100 text-gray-600 border border-gray-200",
    icon: Power,
  },
  error: {
    label: "Error",
    bg: "bg-red-100 text-red-700 border border-red-200",
    icon: XCircle,
  },
};

export default function DetectorStatusBadge({
  status,
  size = "md",
}: {
  status: DetectorStatus;
  size?: "sm" | "md";
}) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  const padding = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${padding} ${cfg.bg}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}
