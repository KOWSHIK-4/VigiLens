import { Activity } from "lucide-react";
import StatusBadge from "./StatusBadge";
import type { ServiceHealth } from "@/types";

function formatMs(ms: number): string {
  return `${Math.round(ms * 100) / 100} ms`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString();
}

export default function ServiceStatusTable({ services }: { services: ServiceHealth[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <Activity className="h-4 w-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-900">Service Monitoring</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Response Time</th>
              <th className="px-4 py-3 font-medium">Version</th>
              <th className="px-4 py-3 font-medium">Last Checked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {services.map((service) => (
              <tr key={service.name} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-gray-900">{service.label}</p>
                  <p className="text-xs text-gray-500 capitalize">{service.name}</p>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={service.status} />
                </td>
                <td className="px-4 py-3 font-medium text-gray-800">
                  {formatMs(service.responseTimeMs)}
                </td>
                <td className="px-4 py-3 text-gray-700">{service.version || "—"}</td>
                <td className="px-4 py-3 text-gray-500">{formatTime(service.lastChecked)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
