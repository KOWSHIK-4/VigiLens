import type { User } from "@/types";

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer",
};

export function roleLabel(role: string): string {
  return (
    ROLE_LABELS[role] ??
    role
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export const ROLE_ORDER: string[] = [
  "super_admin",
  "admin",
  "operator",
  "viewer",
];

const ROLE_ABILITIES: Record<string, string[]> = {
  super_admin: ["manage:all"],
  admin: [
    "users.read",
    "users.write",
    "users.assign_role",
    "users.toggle_status",
    "users.reset_password",
    "roles.read",
    "cameras.read",
    "cameras.write",
    "cameras.control",
    "models.read",
    "models.write",
    "analytics.read",
    "reports.read",
    "reports.manage",
    "alerts.read",
    "audit.read",
    "audit.export",
    "settings.read",
    "settings.manage",
  ],
  operator: ["cameras.read", "cameras.control", "detections.read", "alerts.read", "alerts.manage"],
  viewer: ["cameras.read", "detections.read", "models.read", "analytics.read", "reports.read", "alerts.read"],
};

export function can(role: string | undefined, ability: string): boolean {
  if (!role) return false;
  if (role === "super_admin") return true;
  return ROLE_ABILITIES[role]?.includes(ability) ?? false;
}

export function hasPermission(
  user: Pick<User, "permissions" | "role"> | null | undefined,
  permissionKey: string,
): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  return user.permissions?.some((p) => p.key === permissionKey) ?? false;
}
