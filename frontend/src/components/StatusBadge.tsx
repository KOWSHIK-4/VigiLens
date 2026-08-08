import type { ServiceStatus } from "@/types";

const STYLES: Record<ServiceStatus, { label: string; className: string; dot: string }> = {
  healthy: {
    label: "Healthy",
    className: "bg-green-100 text-green-700",
    dot: "bg-green-500",
  },
  degraded: {
    label: "Degraded",
    className: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
  },
  offline: {
    label: "Offline",
    className: "bg-red-100 text-red-700",
    dot: "bg-red-500",
  },
  not_configured: {
    label: "Not Configured",
    className: "bg-gray-100 text-gray-600",
    dot: "bg-gray-400",
  },
};

export default function StatusBadge({ status }: { status: ServiceStatus }) {
  const style = STYLES[status] ?? STYLES.not_configured;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}
