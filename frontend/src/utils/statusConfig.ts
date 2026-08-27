import { AlertTriangle, Info, ShieldAlert } from "lucide-react";

export type SeverityLevel = "critical" | "warning" | "info";

export interface SeverityStyle {
  label: string;
  badge: string;
  bg: string;
  icon: typeof ShieldAlert;
  iconColor: string;
  dot: string;
  text: string;
}

export const SEVERITY_STYLES: Record<SeverityLevel, SeverityStyle> = {
  critical: {
    label: "Critical",
    badge: "bg-red-100 text-red-700 border-red-200",
    bg: "bg-red-50 border-red-200",
    icon: ShieldAlert,
    iconColor: "text-red-500",
    dot: "bg-red-500",
    text: "text-red-600",
  },
  warning: {
    label: "Warning",
    badge: "bg-yellow-100 text-yellow-700 border-yellow-200",
    bg: "bg-yellow-50 border-yellow-200",
    icon: AlertTriangle,
    iconColor: "text-yellow-500",
    dot: "bg-yellow-500",
    text: "text-yellow-600",
  },
  info: {
    label: "Info",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    bg: "bg-blue-50 border-blue-200",
    icon: Info,
    iconColor: "text-blue-500",
    dot: "bg-blue-500",
    text: "text-blue-600",
  },
};

export function getSeverityStyle(level: string): SeverityStyle {
  return SEVERITY_STYLES[level as SeverityLevel] ?? SEVERITY_STYLES.info;
}