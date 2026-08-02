import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Brain, CheckCircle2, Cpu, PowerOff } from "lucide-react";
import type { AIModel } from "@/types";

const PIE_COLORS = ["#10b981", "#9ca3af"];

const BAR_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
  "#10b981",
  "#6366f1",
];

const CATEGORY_MAP: Record<string, string> = {
  person: "Person",
  fire: "Fire",
  smoking: "Behavior",
  smoke: "Fire",
  helmet: "Safety",
  face_mask: "Safety",
  vehicle: "Vehicle",
  intrusion: "Security",
  abandoned_object: "Security",
  crowd: "Person",
  drowsiness: "Behavior",
};

function categoryOf(key: string): string {
  return CATEGORY_MAP[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " ");
}

function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/2 mb-3" />
      <div className="h-8 bg-gray-200 rounded w-1/3" />
    </div>
  );
}

export default function ModelStats({ models, total }: { models: AIModel[]; total: number }) {
  const enabledCount = models.filter((m) => m.enabled).length;
  const disabledCount = models.filter((m) => !m.enabled).length;
  const gpuCount = models.filter((m) => m.gpuSupported).length;

  const enablementData = [
    { name: "Enabled", value: enabledCount },
    { name: "Disabled", value: disabledCount },
  ];

  const categoryCounts = new Map<string, number>();
  for (const model of models) {
    const category = categoryOf(model.detectorKey);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
  }
  const categoryData = Array.from(categoryCounts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5 text-brand-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Total Models</p>
            <p className="text-3xl font-bold text-gray-900">{total}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Enabled Models</p>
            <p className="text-3xl font-bold text-gray-900">{enabledCount}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
            <PowerOff className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Disabled Models</p>
            <p className="text-3xl font-bold text-gray-900">{disabledCount}</p>
          </div>
        </div>
        <div className="card flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Cpu className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">GPU Supported</p>
            <p className="text-3xl font-bold text-gray-900">{gpuCount}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Enabled vs Disabled
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Distribution of model enablement status
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={enablementData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, value }: { name: string; value: number }) =>
                  `${name}: ${value}`
                }
              >
                {enablementData.map((entry, index) => (
                  <Cell
                    key={`cell-${entry.name}`}
                    fill={PIE_COLORS[index % PIE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Detector Category Distribution
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Number of models per detection category
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Models" radius={[6, 6, 0, 0]}>
                {categoryData.map((entry, index) => (
                  <Cell
                    key={`cell-${entry.category}`}
                    fill={BAR_COLORS[index % BAR_COLORS.length]}
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

export function ModelStatsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card animate-pulse h-[360px]">
          <div className="h-5 bg-gray-200 rounded w-1/2 mb-2" />
          <div className="h-full bg-gray-100 rounded-lg" />
        </div>
        <div className="card animate-pulse h-[360px]">
          <div className="h-5 bg-gray-200 rounded w-1/2 mb-2" />
          <div className="h-full bg-gray-100 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
