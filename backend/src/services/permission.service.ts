import { prisma } from "../config/prisma";

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 200;

interface CachedPermissions {
  keys: Set<string>;
  expiresAt: number;
}

interface CachedPermissionList {
  data: Array<{ id: string; key: string; name: string; description: string; category: string }>;
  expiresAt: number;
}

const permissionCache = new Map<string, CachedPermissions>();

let cachedAll: CachedPermissionList | null = null;

function pruneCache() {
  for (const [role, cached] of permissionCache) {
    if (Date.now() > cached.expiresAt) permissionCache.delete(role);
  }
  while (permissionCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = permissionCache.keys().next().value;
    if (oldest === undefined) break;
    permissionCache.delete(oldest);
  }
}

export const ALL_PERMISSION_KEYS_CATEGORY = "general";

/**
 * Resolves the role row for a (name, organizationId) pair. An organization
 * scoped to the tenant's custom role is preferred; otherwise the instance-wide
 * (global, organizationId NULL) role of the same name acts as the fallback so
 * seeded system roles keep working for every tenant. Returns null when no
 * role matches (unknown names fail closed with an empty permission set).
 */
export async function resolveRole(role: string, organizationId?: string | null) {
  if (organizationId) {
    const orgScoped = await prisma.role.findFirst({
      where: { name: role, organizationId },
    });
    if (orgScoped) return orgScoped;
  }
  return prisma.role.findFirst({
    where: { name: role, organizationId: null },
  });
}

export const permissionService = {
  /**
   * Permission set for a role within an organization, cached per
   * (organizationId, role) pair with a short TTL. Called on every
   * authenticated request, so the cache bounds DB hits to roughly one query
   * per role per TTL; role edits invalidate the affected entry.
   */
  async getPermissionsForRole(role: string, organizationId?: string | null): Promise<Set<string>> {
    const cacheKey = organizationId ? `${organizationId}:${role}` : role;
    const cached = permissionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return new Set(cached.keys);
    }
    const resolved = await resolveRole(role, organizationId);
    const keys = new Set<string>();
    if (resolved) {
      const rows = await prisma.rolePermission.findMany({
        where: { roleId: resolved.id },
        select: { permission: { select: { key: true } } },
      });
      for (const row of rows) keys.add(row.permission.key);
    }
    pruneCache();
    permissionCache.set(cacheKey, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
    return keys;
  },

  /**
   * Full permission catalog used by the role-management UI. The permission
   * rows only change via migrations/seed, so a short TTL is safe.
   */
  async getAllPermissions() {
    if (cachedAll && cachedAll.expiresAt > Date.now()) {
      return cachedAll.data;
    }
    const rows = await prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
      select: { id: true, key: true, name: true, description: true, category: true },
    });
    cachedAll = { data: rows, expiresAt: Date.now() + CACHE_TTL_MS };
    return rows;
  },

  invalidate(role?: string) {
    if (role) {
      permissionCache.delete(role);
      return;
    }
    permissionCache.clear();
    cachedAll = null;
  },
};