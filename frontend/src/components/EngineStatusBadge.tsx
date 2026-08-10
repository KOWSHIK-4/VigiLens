import {
  CheckCircle2,
  CircleDashed,
  Download,
  Loader,
  Power,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { DetectorRuntimeStatus } from "@/types";

const config: Record<
  DetectorRuntimeStatus,
  { label: string; bg: string; icon: LucideIcon; title: string }
> = {
  ready: {
    label: "Ready",
    bg: "bg-green-50 text-green-700 border border-green-200",
    icon: CheckCircle2,
    title: "Model loaded and live inference has succeeded",
  },
  configured: {
    label: "Configured",
    bg: "bg-blue-50 text-blue-700 border border-blue-200",
    icon: CircleDashed,
    title: "Model loaded but no live inference run yet",
  },
  enabled: {
    label: "Enabled",
    bg: "bg-indigo-50 text-indigo-700 border border-indigo-200",
    icon: Power,
    title: "Installed and turned on, model not loaded yet",
  },
  loading: {
    label: "Loading",
    bg: "bg-amber-50 text-amber-700 border border-amber-200",
    icon: Loader,
    title: "Model weights are loading",
  },
  registered: {
    label: "Registered",
    bg: "bg-gray-100 text-gray-600 border border-gray-200",
    icon: CircleDashed,
    title: "Installed, load has not started",
  },
  disabled: {
    label: "Disabled",
    bg: "bg-gray-100 text-gray-500 border border-gray-200",
    icon: Power,
    title: "Turned off by a user",
  },
  error: {
    label: "Error",
    bg: "bg-red-50 text-red-700 border border-red-200",
    icon: XCircle,
    title: "Model load failed or consecutive engine runs failed",
  },
  unavailable: {
    label: "Unavailable",
    bg: "bg-orange-50 text-orange-700 border border-orange-200",
    icon: WifiOff,
    title: "AI inference backend is unreachable",
  },
  unconfigured: {
    label: "No Model",
    bg: "bg-amber-50 text-amber-700 border border-amber-200",
    icon: Download,
    title: "No trained model is configured",
  },
};

export default function EngineStatusBadge({
  status,
}: {
  status: DetectorRuntimeStatus;
}) {
  const cfg = config[status];
  const Icon = cfg.icon;
  return (
    <span
      title={cfg.title}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg}`}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}
