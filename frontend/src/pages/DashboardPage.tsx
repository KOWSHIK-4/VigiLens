import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { ArrowRight, Brain, Cpu } from "lucide-react";
import { detectionService } from "@/services/detections";
import { modelService } from "@/services/models";
import { userService } from "@/services/users";
import StatsCard from "@/components/StatsCard";
import DetectionCard from "@/components/DetectionCard";
import ModelStatusBadge from "@/components/ModelStatusBadge";
import { hasPermission } from "@/utils/permissions";
import { useAuth } from "@/hooks/useAuth";
import type { Detection } from "@/types";

const COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981", "#8b5cf6"];

export default function DashboardPage() {
  const { user } = useAuth();
  const showUserStats = hasPermission(user, "users.read");
  const { data: stats, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => detectionService.getStats(),
    refetchInterval: 30000,
  });

  const { data: activeModel } = useQuery({
    queryKey: ["models", "active"],
    queryFn: () => modelService.getActive().catch((err) => {
      console.warn("Failed to fetch active model:", err);
      return null;
    }),
    refetchInterval: 30000,
  });

  const { data: modelStats } = useQuery({
    queryKey: ["models", "stats"],
    queryFn: () => modelService.getAll({ page: 1, limit: 100 }),
    refetchInterval: 60000,
  });

  const enabledModels =
    modelStats?.data.filter((m) => m.enabled).length ?? 0;

  const { data: userStats } = useQuery({
    queryKey: ["users", "stats"],
    enabled: showUserStats,
    queryFn: () => userService.getStats(),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500 mt-1">
          Real-time security monitoring overview
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Total Detections"
          value={stats?.totalDetections ?? 0}
        />
        <StatsCard
          title="Critical Alerts"
          value={stats?.criticalAlerts ?? 0}
        />
        <StatsCard
          title="Active Cameras"
          value={stats?.activeCameras ?? 0}
        />
        <StatsCard
          title="Avg Confidence"
          value={`${((stats?.avgConfidence ?? 0) * 100).toFixed(1)}%`}
        />
      </div>

      {showUserStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard
            title="Total Users"
            value={userStats?.total ?? 0}
          />
          <StatsCard
            title="Online Now"
            value={userStats?.online ?? 0}
          />
          <StatsCard
            title="Active Users"
            value={userStats?.active ?? 0}
          />
          <StatsCard
            title="Disabled Users"
            value={userStats?.disabled ?? 0}
          />
        </div>
      )}

      <div className="card flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Brain className="w-6 h-6 text-brand-600" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-500">
              Active AI Model
            </p>
            {activeModel ? (
              <div className="flex flex-wrap items-center gap-2 mt-0.5">
                <p className="font-semibold text-gray-900 truncate">
                  {activeModel.name}{" "}
                  <span className="text-gray-400 font-normal">v{activeModel.version}</span>
                </p>
                <ModelStatusBadge status={activeModel.status} />
                {activeModel.gpuSupported && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                    <Cpu className="w-3 h-3" />
                    GPU
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 mt-0.5">
                No model is currently active
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-gray-900">
              {modelStats?.total ?? 0}
            </p>
            <p className="text-xs text-gray-500">Total Models</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">{enabledModels}</p>
            <p className="text-xs text-gray-500">Enabled</p>
          </div>
          <Link
            to="/models"
            className="btn-secondary inline-flex items-center gap-1.5"
          >
            Manage Models
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Detections Over Time
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={stats?.detectionsOverTime ?? []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#3b82f6"
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Alerts by Type
          </h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={stats?.alertsByType ?? []}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label
              >
                {(stats?.alertsByType ?? []).map((_: unknown, index: number) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Recent Detections
        </h3>
        <div className="space-y-4">
          {(stats?.recentDetections ?? []).map((detection: Detection) => (
            <DetectionCard key={detection.id} detection={detection} />
          ))}
        </div>
      </div>
    </div>
  );
}
