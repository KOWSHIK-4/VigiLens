import type { AuditLogStatus } from "@/types";

interface AuditStatusBadgeProps {
  status: AuditLogStatus;
}

export default function AuditStatusBadge({ status }: AuditStatusBadgeProps) {
  const styles =
    status === "success"
      ? "bg-green-50 text-green-700 border-green-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${styles}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          status === "success" ? "bg-green-500" : "bg-red-500"
        }`}
      />
      {status === "success" ? "Success" : "Failed"}
    </span>
  );
}
