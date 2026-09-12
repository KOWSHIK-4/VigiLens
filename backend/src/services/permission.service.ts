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

export const permissionService = {
  /**
   * Permission set for a role, cached per role with a short TTL. Called on
   * every authenticated request, so the cache bounds DB hits to roughly one
   * query per role per TTL; role edits invalidate the affected entry.
   */
  async getPermissionsForRole(role: string): Promise<Set<string>> {
    const cached = permissionCache.get(role);
    if (cached && cached.expiresAt > Date.now()) {
      return new Set(cached.keys);
    }
    const rows = await prisma.rolePermission.findMany({
      where: { role },
      select: { permission: { select: { key: true } } },
    });
    const keys = new Set(rows.map((row) => row.permission.key));
    pruneCache();
    permissionCache.set(role, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
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