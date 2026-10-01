import type { Permission, User } from "@/types";

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

type PermissionLike = string | Permission;

/**
 * Detectors and models are shared instance-wide -- they carry no
 * organizationId, unlike cameras, alerts and incidents -- so the backend
 * restricts their mutations to super_admin rather than to the tenant-level
 * models.manage permission. Use this to hide controls that would only ever
 * come back as a 403.
 */
export function isSuperAdmin(
  user: Pick<User, "permissions" | "role"> | null | undefined,
): boolean {
  return user?.role === "super_admin";
}

export function hasPermission(
  user: Pick<User, "permissions" | "role"> | null | undefined,
  permissionKey: string,
): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (!user.permissions) return false;
  return user.permissions.some((p: PermissionLike) =>
    typeof p === "string" ? p === permissionKey : p.key === permissionKey,
  );
}
