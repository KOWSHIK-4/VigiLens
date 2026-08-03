import type { UserRole } from "@/types";

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

export const ROLE_ORDER: UserRole[] = [
  "super_admin",
  "admin",
  "operator",
  "viewer",
];

const ROLE_ABILITIES: Record<UserRole, string[]> = {
  super_admin: ["manage:all"],
  admin: [
    "users:read",
    "users:write",
    "users:assign-role",
    "users:toggle-status",
    "users:reset-password",
    "roles:read",
    "cameras:write",
    "models:write",
  ],
  operator: ["cameras:read", "cameras:control", "detections:read", "alerts:manage"],
  viewer: ["cameras:read", "detections:read"],
};

export function can(role: UserRole | undefined, ability: string): boolean {
  if (!role) return false;
  if (role === "super_admin") return true;
  return ROLE_ABILITIES[role]?.includes(ability) ?? false;
}
