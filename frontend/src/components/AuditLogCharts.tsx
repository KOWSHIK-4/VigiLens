import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import type { AuditLogChartData } from "@/types";

interface AuditLogChartsProps {
  data: AuditLogChartData;
}

const MODULE_COLORS = ["#2563eb", "#059669", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5"];

function formatChartDate(value: string): string {
  const date = new Date(value + "T00:00:00");
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function AuditLogCharts({ data }: AuditLogChartsProps) {
  const actionsPerDay = data.actionsPerDay.map((d) => ({
    ...d,
    displayDate: formatChartDate(d.date),
  }));

  const moduleUsage = data.moduleUsage.map((m, i) => ({
    ...m,
    fill: MODULE_COLORS[i % MODULE_COLORS.length],
  }));

  const statusData = data.statusDistribution.map((s) => ({
    name: s.status === "success" ? "Success" : "Failed",
    value: s.count,
    color: s.status === "success" ? "#059669" : "#dc2626",
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Actions per Day</h3>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={actionsPerDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="displayDate" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Module Usage</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={moduleUsage}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="module" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {moduleUsage.map((entry) => (
                <Cell key={entry.module} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Success vs Failed</h3>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={statusData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              paddingAngle={2}
              label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
            >
              {statusData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Top Active Users</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.topUsers} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="username"
              width={90}
              tick={{ fontSize: 11 }}
              stroke="#9ca3af"
            />
            <Tooltip />
            <Bar dataKey="count" fill="#7c3aed" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function AuditLogChartsSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-pulse">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card p-5 space-y-4">
          <div className="h-4 w-32 bg-gray-200 rounded" />
          <div className="h-48 bg-gray-100 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
