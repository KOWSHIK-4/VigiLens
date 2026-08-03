import { Shield, ShieldCheck, ShieldHalf, Eye } from "lucide-react";
import { ROLE_LABELS } from "@/utils/permissions";
import type { UserRole } from "@/types";

const ROLE_STYLES: Record<UserRole, { badge: string; icon: typeof Shield }> = {
  super_admin: { badge: "bg-purple-50 text-purple-700 border-purple-200", icon: ShieldCheck },
  admin: { badge: "bg-blue-50 text-blue-700 border-blue-200", icon: Shield },
  operator: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: ShieldHalf },
  viewer: { badge: "bg-gray-100 text-gray-600 border-gray-200", icon: Eye },
};

export default function RoleBadge({ role }: { role: UserRole }) {
  const { badge, icon: Icon } = ROLE_STYLES[role];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badge}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {ROLE_LABELS[role]}
    </span>
  );
}
