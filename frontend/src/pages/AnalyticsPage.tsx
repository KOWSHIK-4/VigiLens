import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, LineChart, Line, Legend,
} from "recharts";
import { Download, RefreshCw, Calendar, Clock } from "lucide-react";
import { analyticsService } from "@/services/analytics";
import StatsCard from "@/components/StatsCard";
import type { AnalyticsParams } from "@/types";

type Period = "7" | "30" | "90";

const PIE_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899"];
const CHART_COLORS = ["#3b82f6", "#ef4444", "#f59e0b", "#10b981", "#8b5cf6"];

const periodLabels: Record<Period, string> = { "7": "Last 7 Days", "30": "Last 30 Days", "90": "Last 90 Days" };

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 shadow-lg rounded-lg p-3 text-sm">
      <p className="font-semibold text-gray-900 mb-1">{label}</p>
      {payload.map((entry: any, i: number) => (
        <p key={i} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
        </p>
      ))}
    </div>
  );
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("7");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const params: AnalyticsParams = useMemo(() => ({ period }), [period]);

  const refetchInterval = autoRefresh ? 30_000 : undefined;

  const overviewQuery = useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: analyticsService.getOverview,
    refetchInterval,
  });

  const dailyQuery = useQuery({
    queryKey: ["analytics", "daily", period],
    queryFn: () => analyticsService.getDaily(params),
    refetchInterval,
  });

  const camerasQuery = useQuery({
    queryKey: ["analytics", "cameras", period],
    queryFn: () => analyticsService.getCameras(params),
    refetchInterval,
  });

  const detectorsQuery = useQuery({
    queryKey: ["analytics", "detectors", period],
    queryFn: () => analyticsService.getDetectors(params),
    refetchInterval,
  });

  const timelineQuery = useQuery({
    queryKey: ["analytics", "timeline", period],
    queryFn: () => analyticsService.getTimeline(params),
    refetchInterval,
  });

  const confidenceQuery = useQuery({
    queryKey: ["analytics", "confidence", period],
    queryFn: () => analyticsService.getConfidenceDistribution(params),
    refetchInterval,
  });

  const isLoading = overviewQuery.isLoading || dailyQuery.isLoading;

  const overview = overviewQuery.data;
  const dailyData = dailyQuery.data ?? [];
  const camerasData = camerasQuery.data ?? [];
  const detectorsData = detectorsQuery.data ?? [];
  const timelineData = timelineQuery.data ?? [];
  const confidenceData = confidenceQuery.data ?? [];

  useEffect(() => {
    if (overviewQuery.data) setLastRefreshed(new Date());
  }, [overviewQuery.data]);

  const handleExport = useCallback((dataset: "daily" | "cameras" | "detectors") => {
    if (dataset === "daily" && dailyData.length > 0) {
      downloadCSV(
        `detection-trend-${period}d`,
        ["Date", "Total", "Critical", "Warning", "Info"],
        dailyData.map((d) => [d.date, String(d.total), String(d.critical), String(d.warning), String(d.info)]),
      );
    }
    if (dataset === "cameras" && camerasData.length > 0) {
      downloadCSV(
        `camera-activity-${period}d`,
        ["Camera", "Location", "Status", "Detections"],
        camerasData.map((c) => [c.name, c.location ?? "", c.status, String(c.detectionCount)]),
      );
    }
    if (dataset === "detectors" && detectorsData.length > 0) {
      downloadCSV(
        `detector-types-${period}d`,
        ["Label", "Count", "Percentage", "Avg Confidence", "Min Confidence", "Max Confidence"],
        detectorsData.map((d) => [d.label, String(d.count), String(d.percentage), String(d.avgConfidence), String(d.minConfidence), String(d.maxConfidence)]),
      );
    }
  }, [dailyData, camerasData, detectorsData, period]);

  const severityData = useMemo(
    () => overview?.severityDistribution ?? [],
    [overview],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
          <p className="text-gray-500 mt-1">Enterprise-level detection insights and trends</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
            {(["7", "30", "90"] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  period === p
                    ? "bg-brand-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
              autoRefresh
                ? "bg-green-50 border-green-300 text-green-700"
                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}
          >
            <RefreshCw className={`w-4 h-4 ${autoRefresh ? "animate-spin" : ""}`} />
            Auto
          </button>
          <div className="relative group">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium">
              <Download className="w-4 h-4" />
              Export
            </button>
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[180px]">
              <button onClick={() => handleExport("daily")} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Detection Trend</button>
              <button onClick={() => handleExport("cameras")} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Camera Activity</button>
              <button onClick={() => handleExport("detectors")} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Detection Types</button>
            </div>
          </div>
        </div>
      </div>

      <div className="text-sm text-gray-500 flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Calendar className="w-4 h-4" />
          {periodLabels[period]}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-4 h-4" />
          Last updated: {lastRefreshed.toLocaleTimeString()}
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard title="Total Detections" value={formatNumber(overview?.totalDetections ?? 0)} />
        <StatsCard title="Today's Detections" value={formatNumber(overview?.todayDetections ?? 0)} />
        <StatsCard title="Active Cameras" value={`${overview?.activeCameras ?? 0} / ${overview?.totalCameras ?? 0}`} />
        <StatsCard title="Avg Confidence" value={`${((overview?.averageConfidence ?? 0) * 100).toFixed(1)}%`} />
        <StatsCard title="Offline Cameras" value={overview?.offlineCameras ?? 0} />
        <StatsCard
          title="Detection Rate"
          value={`${(overview?.detectionRate ?? 0).toFixed(1)}/day`}
        />
        <StatsCard title="Most Active Camera" value={overview?.mostActiveCamera?.name ?? "N/A"} />
        <StatsCard title="Top Detection" value={overview?.mostCommonDetectionType ?? "N/A"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Detection Trend ({periodLabels[period]})</h3>
            <button onClick={() => handleExport("daily")} className="text-gray-400 hover:text-gray-600 p-1" title="Export CSV">
              <Download className="w-4 h-4" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="total" stroke="#3b82f6" fill="url(#colorTotal)" strokeWidth={2} name="Total" />
              <Area type="monotone" dataKey="critical" stroke="#ef4444" fill="none" strokeWidth={2} name="Critical" />
              <Area type="monotone" dataKey="warning" stroke="#f59e0b" fill="none" strokeWidth={2} name="Warning" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Detection Type Distribution</h3>
            <button onClick={() => handleExport("detectors")} className="text-gray-400 hover:text-gray-600 p-1" title="Export CSV">
              <Download className="w-4 h-4" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={detectorsData}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={110}
                innerRadius={50}
                label={({ label, percent }) => `${label} ${(percent * 100).toFixed(0)}%`}
              >
                {detectorsData.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Camera Activity</h3>
            <button onClick={() => handleExport("cameras")} className="text-gray-400 hover:text-gray-600 p-1" title="Export CSV">
              <Download className="w-4 h-4" />
            </button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={camerasData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fontSize: 12 }}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="detectionCount" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Detections">
                {camerasData.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Hourly Detection Timeline</h3>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="hour" tick={{ fontSize: 11 }} tickLine={false} interval={2} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={{ r: 3, fill: "#8b5cf6" }}
                name="Detections"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Severity Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={severityData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {severityData.map((entry, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={
                      entry.name === "critical" ? "#ef4444"
                        : entry.name === "warning" ? "#f59e0b"
                        : "#3b82f6"
                    }
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Confidence Distribution</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={confidenceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="range" tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Detections">
                {confidenceData.map((_, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={
                      i >= 4 ? "#10b981" : i >= 2 ? "#f59e0b" : "#ef4444"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
