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
