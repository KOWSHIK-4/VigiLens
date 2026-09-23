import { prisma } from "../config/prisma";
import { ApiError } from "../utils/errors";

export const SUPER_ADMIN_ROLE = "super_admin";

/**
 * Deterministic ordering of the seeded system roles. A role with a higher
 * rank holds at least as much authority as every role below it. Custom
 * (organization-created) roles carry no built-in rank; their assignability
 * is governed by the granter-possesses permission check instead.
 */
export const SYSTEM_ROLE_RANK: Record<string, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  super_admin: 4,
};

export function roleRank(role: string): number {
  return SYSTEM_ROLE_RANK[role] ?? 0;
}

export function isSystemRole(role: string): boolean {
  return role in SYSTEM_ROLE_RANK;
}

export interface GrantDecision {
  allowed: boolean;
  reason?: string;
}

async function loadRolePermissions(role: string): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { role },
    select: { permission: { select: { key: true } } },
  });
  return rows.map((row) => row.permission.key);
}

/**
 * Decides whether an actor may grant `targetRole` (either by assigning it to
 * a user or by creating an account that holds it). Rules:
 *
 *  - only a Super Admin may grant (or create) the Super Admin role;
 *  - the actor must already possess every permission the target role carries
 *    (granter-possesses: nobody can mint authority they do not hold);
 *  - a seeded role may never be granted at or above the actor's own rank.
 */
export async function canGrantRole(
  actorRole: string,
  actorPermissions: Set<string>,
  targetRole: string,
): Promise<GrantDecision> {
  if (targetRole === SUPER_ADMIN_ROLE && actorRole !== SUPER_ADMIN_ROLE) {
    return { allowed: false, reason: "Only a Super Admin can grant the Super Admin role" };
  }

  const required = await loadRolePermissions(targetRole);
  const missing = required.filter((key) => !actorPermissions.has(key));
  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `You do not possess required permission${missing.length > 1 ? "s" : ""}: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`,
    };
  }

  if (actorRole === SUPER_ADMIN_ROLE) {
    return { allowed: true };
  }

  if (isSystemRole(targetRole)) {
    const actorRank = roleRank(actorRole);
    const targetRank = roleRank(targetRole);
    if (targetRank >= actorRank) {
      return {
        allowed: false,
        reason: `Cannot grant "${targetRole}" — it is at or above your own rank`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Throws a 403 unless the actor may control an account holding `targetRole`.
 * Only a Super Admin may modify, reset, lock, disable or demote another
 * Super Admin account.
 */
export function assertMayControlRole(actorRole: string, targetRole: string): void {
  if (targetRole === SUPER_ADMIN_ROLE && actorRole !== SUPER_ADMIN_ROLE) {
    throw new ApiError(403, "Only a Super Admin can modify Super Admin accounts");
  }
}

export function assertActorPossessesPermissions(
  actorPermissions: Set<string>,
  permissionKeys: string[],
  targetName: string,
): void {
  const missing = permissionKeys.filter((key) => !actorPermissions.has(key));
  if (missing.length > 0) {
    throw new ApiError(
      403,
      `You cannot grant "${targetName}" permission${missing.length > 1 ? "s" : ""} you do not hold: ${missing.join(", ")}`,
    );
  }
}