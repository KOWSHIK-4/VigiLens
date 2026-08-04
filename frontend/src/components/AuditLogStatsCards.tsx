import { Activity, CalendarCheck, FileWarning, Users } from "lucide-react";
import type { AuditLogStats } from "@/types";

interface AuditLogStatsCardsProps {
  stats: AuditLogStats;
}

export function AuditLogStatsCards({ stats }: AuditLogStatsCardsProps) {
  const cards = [
    {
      label: "Total Audit Logs",
      value: stats.totalLogs.toLocaleString(),
      icon: Activity,
      color: "text-brand-600 bg-brand-50",
    },
    {
      label: "Today's Actions",
      value: stats.todayLogs.toLocaleString(),
      icon: CalendarCheck,
      color: "text-emerald-600 bg-emerald-50",
    },
    {
      label: "Failed Actions",
      value: stats.failedLogs.toLocaleString(),
      icon: FileWarning,
      color: "text-red-600 bg-red-50",
    },
    {
      label: "Active Users",
      value: stats.activeUsers.toLocaleString(),
      icon: Users,
      color: "text-violet-600 bg-violet-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="card flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${card.color}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900 leading-tight">{card.value}</p>
              <p className="text-sm text-gray-500 truncate">{card.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AuditLogStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 animate-pulse">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gray-200" />
          <div className="flex-1 space-y-2">
            <div className="h-6 w-16 bg-gray-200 rounded" />
            <div className="h-4 w-24 bg-gray-200 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}
