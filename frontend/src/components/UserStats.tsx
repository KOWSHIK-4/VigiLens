import { Users, UserCheck, UserMinus, Wifi } from "lucide-react";
import type { UserStats } from "@/types";

function StatCard({
  label,
  value,
  icon,
  iconClass,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  iconClass: string;
}) {
  return (
    <div className="card flex items-center gap-4">
      <div
        className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${iconClass}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <p className="text-3xl font-bold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

export default function UserStatsCards({ stats }: { stats: UserStats }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <StatCard
        label="Total Users"
        value={stats.total}
        icon={<Users className="w-5 h-5 text-brand-600" />}
        iconClass="bg-brand-50"
      />
      <StatCard
        label="Online Users"
        value={stats.online}
        icon={<Wifi className="w-5 h-5 text-cyan-600" />}
        iconClass="bg-cyan-50"
      />
      <StatCard
        label="Active Users"
        value={stats.active}
        icon={<UserCheck className="w-5 h-5 text-green-600" />}
        iconClass="bg-green-50"
      />
      <StatCard
        label="Disabled Users"
        value={stats.disabled}
        icon={<UserMinus className="w-5 h-5 text-gray-500" />}
        iconClass="bg-gray-100"
      />
    </div>
  );
}

export function UserStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="card animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-3" />
          <div className="h-8 bg-gray-200 rounded w-1/3" />
        </div>
      ))}
    </div>
  );
}
