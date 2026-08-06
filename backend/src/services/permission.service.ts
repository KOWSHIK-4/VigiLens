import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";

const CACHE_TTL_MS = 30_000;

interface CachedPermissions {
  keys: Set<string>;
  expiresAt: number;
}

const permissionCache = new Map<string, CachedPermissions>();

export const ALL_PERMISSION_KEYS_CATEGORY = "general";

export const permissionService = {
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
    permissionCache.set(role, {
      keys,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return keys;
  },

  async getAllPermissions() {
    return prisma.permission.findMany({
      orderBy: [{ category: "asc" }, { key: "asc" }],
    });
  },

  invalidate(role?: string) {
    if (role) {
      permissionCache.delete(role);
      logger.debug("Permission cache invalidated", { role });
      return;
    }
    permissionCache.clear();
    logger.debug("Permission cache cleared");
  },
};
