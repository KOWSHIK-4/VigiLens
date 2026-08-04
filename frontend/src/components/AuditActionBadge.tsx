import type { AuditLogAction } from "@/types";
import { actionLabels, actionStyles } from "@/utils/auditLogs";

interface AuditActionBadgeProps {
  action: AuditLogAction;
}

export default function AuditActionBadge({ action }: AuditActionBadgeProps) {
  const style = actionStyles[action] ?? actionStyles.settings_changed;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${style.bg} ${style.text} ${style.border}`}
    >
      {actionLabels[action] ?? action}
    </span>
  );
}
