import { CheckCircle2, MinusCircle } from "lucide-react";
import type { DetectorAvailability } from "@/types";

const config: Record<
  DetectorAvailability,
  { label: string; bg: string; icon: typeof CheckCircle2; title: string }
> = {
  available: {
    label: "Model ready",
    bg: "bg-green-50 text-green-700 border border-green-200",
    icon: CheckCircle2,
    title: "A trained model is available for this detector",
  },
  unconfigured: {
    label: "No model",
    bg: "bg-amber-50 text-amber-700 border border-amber-200",
    icon: MinusCircle,
    title:
      "No trained model is configured — this detector never fabricates detections",
  },
};

export default function DetectorAvailabilityBadge({
  availability,
}: {
  availability: DetectorAvailability;
}) {
  const cfg = config[availability];
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
