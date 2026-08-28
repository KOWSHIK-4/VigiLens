import { CheckCircle2, Loader2, Power, XCircle } from "lucide-react";
import type { ModelStatus } from "@/types";

const statusConfig: Record<
  ModelStatus,
  { label: string; bg: string; icon: typeof CheckCircle2; spin?: boolean }
> = {
  loaded: {
    label: "Loaded",
    bg: "bg-green-100 text-green-700",
    icon: CheckCircle2,
  },
  loading: {
    label: "Loading",
    bg: "bg-yellow-100 text-yellow-700",
    icon: Loader2,
    spin: true,
  },
  disabled: {
    label: "Disabled",
    bg: "bg-gray-100 text-gray-600",
    icon: Power,
  },
  error: {
    label: "Error",
    bg: "bg-red-100 text-red-700",
    icon: XCircle,
  },
};

export default function ModelStatusBadge({ status }: { status: ModelStatus }) {
  const cfg = statusConfig[status] ?? statusConfig.error;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.bg}`}
    >
      <Icon className={`w-3.5 h-3.5 ${cfg.spin ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}
