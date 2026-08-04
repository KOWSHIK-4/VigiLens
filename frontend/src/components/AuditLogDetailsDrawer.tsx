import type { AuditLog } from "@/types";
import { X, Clock, User, Box, Globe, Monitor, Fingerprint, FileJson } from "lucide-react";
import AuditActionBadge from "./AuditActionBadge";
import AuditStatusBadge from "./AuditStatusBadge";

interface AuditLogDetailsDrawerProps {
  log: AuditLog | null;
  onClose: () => void;
}

function formatMetadata(metadata: Record<string, unknown> | null | undefined): Array<[string, string]> {
  if (!metadata) return [];
  try {
    return Object.entries(metadata).map(([key, value]) => [
      key,
      typeof value === "object" && value !== null ? JSON.stringify(value) : String(value),
    ]);
  } catch {
    return [];
  }
}

export default function AuditLogDetailsDrawer({ log, onClose }: AuditLogDetailsDrawerProps) {
  if (!log) return null;

  const metadataEntries = formatMetadata(log.metadata);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed top-0 right-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <Fingerprint className="w-5 h-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">Audit Log Details</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <AuditActionBadge action={log.action} />
            <AuditStatusBadge status={log.status} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <DetailItem
              icon={<Clock className="w-4 h-4" />}
              label="Timestamp"
              value={new Date(log.timestamp).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "medium",
              })}
            />
            <DetailItem
              icon={<Box className="w-4 h-4" />}
              label="Module"
              value={log.module}
            />
            <DetailItem
              icon={<User className="w-4 h-4" />}
              label="User"
              value={log.username || "System"}
            />
            <DetailItem icon={<User className="w-4 h-4" />} label="Email" value={log.email || "—"} />
            <DetailItem
              icon={<Globe className="w-4 h-4" />}
              label="IP Address"
              value={log.ipAddress || "—"}
            />
            <DetailItem
              icon={<Monitor className="w-4 h-4" />}
              label="User Agent"
              value={log.userAgent || "—"}
            />
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Description</h3>
            <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{log.description}</p>
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="flex items-center gap-2 text-sm font-medium text-gray-900 mb-3">
              <FileJson className="w-4 h-4 text-gray-400" />
              Metadata
              {log.metadata && (
                <span className="text-xs font-normal text-gray-400">
                  ({metadataEntries.length} fields)
                </span>
              )}
            </h3>
            {metadataEntries.length > 0 ? (
              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {metadataEntries.map(([key, value]) => (
                  <div
                    key={key}
                    className="grid grid-cols-[1fr_2fr] gap-3 px-3 py-2 text-sm bg-white"
                  >
                    <span className="text-gray-500 font-mono text-xs pt-0.5 break-all">{key}</span>
                    <span className="text-gray-900 font-mono text-xs break-all">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No metadata recorded for this event.</p>
            )}
          </div>

          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Log ID</h3>
            <p className="text-xs font-mono text-gray-500 break-all">{log.id}</p>
          </div>
        </div>
      </div>
    </>
  );
}

function DetailItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-center gap-1.5 text-sm text-gray-900">
        {icon}
        <span className="font-medium break-all">{value}</span>
      </div>
    </div>
  );
}
