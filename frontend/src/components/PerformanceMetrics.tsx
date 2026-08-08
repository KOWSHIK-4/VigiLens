import { Activity, Gauge, ScanEye, Timer, TrendingUp } from "lucide-react";
import type { SystemMetrics } from "@/types";

function formatMs(ms: number): string {
  return `${Math.round(ms * 100) / 100} ms`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

interface MetricTileProps {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
  Icon: typeof Activity;
}

function MetricTile({ label, value, hint, danger, Icon }: MetricTileProps) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <Icon className="h-4 w-4 text-gray-400" />
      </div>
      <p className={`mt-1 text-2xl font-bold ${danger ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export default function PerformanceMetrics({ metrics }: { metrics: SystemMetrics }) {
  const { requests, detections } = metrics;
  const slowPct = requests.total > 0 ? requests.slowRequestCount / requests.total : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-900">Performance</h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="API Requests"
          value={formatCount(requests.total)}
          hint={`Last ${Math.round(metrics.windowSeconds / 60)} min`}
          Icon={Activity}
        />
        <MetricTile
          label="Avg Response Time"
          value={formatMs(requests.averageResponseTimeMs)}
          hint={`P95 ${formatMs(requests.p95ResponseTimeMs)}`}
          Icon={Timer}
        />
        <MetricTile
          label="Slow Requests"
          value={formatCount(requests.slowRequestCount)}
          hint={`${Math.round(slowPct * 100)}% of total`}
          danger={requests.slowRequestCount > 0}
          Icon={Gauge}
        />
        <MetricTile
          label="Error Rate"
          value={formatPercent(requests.errorRate)}
          hint={`${formatCount(requests.errorCount)} errors`}
          danger={requests.errorRate > 0.01}
          Icon={TrendingUp}
        />
      </div>

      <div className="card">
        <div className="mb-4 flex items-center gap-2">
          <ScanEye className="h-4 w-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Detection Processing</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-gray-500">Detections processed</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatCount(detections.total)}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Avg processing time</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {formatMs(detections.averageProcessingTimeMs)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
