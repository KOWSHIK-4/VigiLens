import { Shield, ShieldCheck, ShieldHalf, Eye, UserCircle } from "lucide-react";
import { roleLabel } from "@/utils/permissions";

const ROLE_STYLES: Record<string, { badge: string; icon: typeof Shield }> = {
  super_admin: { badge: "bg-purple-50 text-purple-700 border-purple-200", icon: ShieldCheck },
  admin: { badge: "bg-blue-50 text-blue-700 border-blue-200", icon: Shield },
  operator: { badge: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: ShieldHalf },
  viewer: { badge: "bg-gray-100 text-gray-600 border-gray-200", icon: Eye },
};

const FALLBACK_STYLE = { badge: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: UserCircle };

export default function RoleBadge({ role }: { role: string }) {
  const { badge, icon: Icon } = ROLE_STYLES[role] ?? FALLBACK_STYLE;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${badge}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {roleLabel(role)}
    </span>
  );
}
