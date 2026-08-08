import { Cpu, Gauge, Timer } from "lucide-react";
import type { SystemMonitoring } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function barColor(usage: number): string {
  if (usage >= 90) return "bg-red-500";
  if (usage >= 75) return "bg-amber-500";
  return "bg-brand-600";
}

function ResourceBar({
  label,
  usage,
  detail,
}: {
  label: string;
  usage: number;
  detail: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-gray-600">{label}</p>
        <p className="text-sm font-semibold text-gray-900">{Math.round(usage)}%</p>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-gray-100">
        <div
          className={`h-2 rounded-full ${barColor(usage)}`}
          style={{ width: `${Math.min(Math.max(usage, 0), 100)}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  );
}

export default function SystemResources({
  resources,
  uptime,
}: {
  resources: SystemMonitoring["resources"];
  uptime: { process: number; system: number };
}) {
  const memoryDetail = `${formatBytes(resources.memory.usedBytes)} of ${formatBytes(resources.memory.totalBytes)} used`;

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <Gauge className="h-4 w-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">System Resources</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <ResourceBar
            label="CPU"
            usage={resources.cpu.usagePercent}
            detail={`${resources.cpu.cores} cores`}
          />
          <ResourceBar
            label="Memory"
            usage={resources.memory.usagePercent}
            detail={memoryDetail}
          />
          <ResourceBar
            label="Disk"
            usage={resources.disk.usagePercent}
            detail={`${formatBytes(resources.disk.freeBytes)} free on ${resources.disk.mount}`}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
            <Timer className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Backend uptime</p>
            <p className="text-lg font-bold text-gray-900">
              {formatDuration(uptime.process)}
            </p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-100">
            <Cpu className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Host system uptime</p>
            <p className="text-lg font-bold text-gray-900">
              {formatDuration(uptime.system)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
