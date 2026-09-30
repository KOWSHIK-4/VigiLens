import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import type {
  SettingDefinition,
  SettingValue,
  SettingsCategoryDefinition,
} from "../settings";
import {
  getSettingCategories,
  getSettingCategory,
  getSettingDefinition,
  isHttpUrl,
  isInstanceScopedSetting,
  isValidSettingValue,
} from "../settings";
import { isSafeStorageBasePath } from "../utils/storagePath";
import type { Prisma, SystemSetting, SystemSettingCategory } from "@prisma/client";
import { SECRET_MASK } from "../utils/redact";

const CACHE_TTL_MS = 60_000;

interface CachedSettings {
  data: SystemSetting[];
  loadedAt: number;
}

const cachedByOrg = new Map<string, CachedSettings>();

export interface SerializedSetting {
  key: string;
  category: SystemSettingCategory;
  label: string;
  description: string;
  type: SettingDefinition["type"];
  value: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: SettingDefinition["options"];
  /**
   * True for settings whose value is secret material (webhook signing
   * secret, SMTP credentials). The stored value is masked in API responses
   * and `configured` reports whether a secret is actually set.
   */
  sensitive?: boolean;
  /** True when a sensitive setting currently has a stored value. */
  configured?: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

function serialize(
  category: SystemSettingCategory,
  def: SettingDefinition,
  row: SystemSetting | undefined,
): SerializedSetting {
  const stored = (row?.value as SettingValue) ?? def.defaultValue;
  const result: SerializedSetting = {
    key: def.key,
    category,
    label: row?.label ?? def.label,
    description: row?.description ?? def.description,
    type: def.type,
    value: stored,
    updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString(),
    updatedBy: row?.updatedBy ?? null,
  };
  if (def.min !== undefined) result.min = def.min;
  if (def.max !== undefined) result.max = def.max;
  if (def.step !== undefined) result.step = def.step;
  if (def.unit !== undefined) result.unit = def.unit;
  if (def.options !== undefined) result.options = def.options;
  if (def.sensitive) {
    result.sensitive = true;
    result.configured = typeof stored === "string" && stored.length > 0;
    result.value = result.configured ? SECRET_MASK : def.defaultValue;
  }
  return result;
}

async function loadAll(organizationId = ""): Promise<SystemSetting[]> {
  const cached = cachedByOrg.get(organizationId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  const rows = await prisma.systemSetting.findMany({ where: { organizationId } });
  cachedByOrg.set(organizationId, { data: rows, loadedAt: Date.now() });
  return rows;
}

function invalidateCache() {
  cachedByOrg.clear();
}

/**
   * Read view for a tenant: the tenant's own rows plus the instance rows the
   * host-level settings are served from. At the instance scope both sets are
   * the same rows, so only one query is issued.
   */
async function loadForRead(organizationId = ""): Promise<{ rows: SystemSetting[]; instanceRows: SystemSetting[] }> {
  const rows = await loadAll(organizationId);
  if (organizationId === "") {
    return { rows, instanceRows: rows };
  }
  const instanceRows = (await loadAll("")).filter((r) => isInstanceScopedSetting(r.category, r.key));
  return { rows, instanceRows };
}

function settingMapFor(category: SettingsCategoryDefinition, rows: SystemSetting[]) {
  return new Map(rows.filter((r) => r.category === category.key).map((r) => [r.key, r]));
}

export const settingsService = {
  async ensureDefaults(): Promise<number> {
    let created = 0;
    for (const category of getSettingCategories()) {
      const result = await prisma.systemSetting.createMany({
        data: category.settings.map((def) => ({
          category: category.key,
          key: def.key,
          label: def.label,
          description: def.description,
          value: def.defaultValue as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      created += result.count;
    }
    if (created > 0) {
      logger.info("Seeded default system settings", { count: created });
    }

    // Seeded rows that were never explicitly modified (updatedBy null) are
    // expected to track the current definition defaults, so they only ever
    // exist at the instance-wide "" scope. Rewrite any that drifted (e.g. a
    // default value changed in code) so existing deployments inherit the
    // behavior the current code documents instead of being stuck with a stale
    // value from an earlier release. Organization-scoped rows are owned by
    // their tenant and are never touched here.
    const seedRows = await prisma.systemSetting.findMany({
      where: { updatedBy: null, organizationId: "" },
    });
    let normalized = 0;
    for (const row of seedRows) {
      const def = getSettingDefinition(row.category, row.key);
      if (!def) continue;
      const stored = row.value as SettingValue;
      if (stored !== def.defaultValue) {
        await prisma.systemSetting.update({
          where: { organizationId_category_key: { organizationId: "", category: row.category, key: row.key } },
          data: { value: def.defaultValue as Prisma.InputJsonValue },
        });
        normalized += 1;
      }
    }
    if (normalized > 0) {
      logger.info("Normalized drifted default settings", { count: normalized });
    }

    // Host-level settings are only ever read at the instance scope, so a
    // tenant row for one of them (written before these keys were recognized
    // as instance-wide) is unreachable shadow state. Drop it so the table does
    // not accumulate rows that look effective but are not.
    const orphaned = await prisma.systemSetting.findMany({
      where: { organizationId: { not: "" } },
      select: { category: true, key: true },
    });
    const stale = orphaned.filter((row) => isInstanceScopedSetting(row.category, row.key));
    if (stale.length > 0) {
      await prisma.systemSetting.deleteMany({
        where: {
          organizationId: { not: "" },
          OR: stale.map((row) => ({ category: row.category, key: row.key })),
        },
      });
      logger.info("Removed tenant-scoped copies of instance-wide settings", {
        count: stale.length,
      });
    }
    return created;
  },

  /**
   * Host-level settings (the shared media root, its quota, global retention)
   * only ever live at the instance scope, so a tenant view has to overlay
   * them from there instead of reporting the code default. Without the
   * overlay a tenant would be shown a value the instance is not using.
   */
  async getAll(organizationId = ""): Promise<SerializedSetting[]> {
    const { rows, instanceRows } = await loadForRead(organizationId);
    const serialized: SerializedSetting[] = [];
    for (const category of getSettingCategories()) {
      const byKey = settingMapFor(category, rows);
      const instanceByKey = settingMapFor(category, instanceRows);
      for (const def of category.settings) {
        const row = def.instanceScoped ? instanceByKey.get(def.key) ?? byKey.get(def.key) : byKey.get(def.key);
        serialized.push(serialize(category.key, def, row));
      }
    }
    return serialized;
  },

  async getByCategory(category: SystemSettingCategory, organizationId = ""): Promise<SerializedSetting[]> {
    const definition = getSettingCategory(category);
    if (!definition) {
      throw new ApiError(400, `Unknown settings category "${category}"`);
    }
    const { rows, instanceRows } = await loadForRead(organizationId);
    const byKey = settingMapFor(definition, rows);
    const instanceByKey = settingMapFor(definition, instanceRows);
    return definition.settings.map((def) => {
      const row = def.instanceScoped ? instanceByKey.get(def.key) ?? byKey.get(def.key) : byKey.get(def.key);
      return serialize(category, def, row);
    });
  },

  async update(
    category: SystemSettingCategory,
    values: Record<string, SettingValue>,
    actorId?: string,
    organizationId = "",
  ): Promise<SerializedSetting[]> {
    const definition = getSettingCategory(category);
    if (!definition) {
      throw new ApiError(400, `Unknown settings category "${category}"`);
    }

    const entries = Object.entries(values);
    if (entries.length === 0) {
      throw new ApiError(400, "No settings provided to update");
    }

    for (const [key, value] of entries) {
      const def = getSettingDefinition(category, key);
      if (!def) {
        throw new ApiError(400, `Unknown setting "${key}" in category "${category}"`);
      }
      if (!isValidSettingValue(def, value)) {
        throw new ApiError(400, `Invalid value for setting "${key}"`);
      }
      if (
        category === "notifications" &&
        key === "webhook_url" &&
        typeof value === "string" &&
        value.length > 0 &&
        !isHttpUrl(value)
      ) {
        throw new ApiError(400, `Invalid value for setting "${key}"`);
      }
      // The media root is written to by snapshot capture and probed by the
      // health check, so reject a root-like path at write time rather than
      // letting it be stored and only discovered by the prune tool later.
      if (
        category === "storage" &&
        key === "storage_base_path" &&
        typeof value === "string" &&
        !isSafeStorageBasePath(value)
      ) {
        throw new ApiError(400, `Invalid value for setting "${key}"`);
      }
    }

    // Clients only ever see the masked placeholder for sensitive settings, so
    // echoing it back must never overwrite the real secret with the mask.
    const effectiveEntries = entries.filter(([key, value]) => {
      const setting = getSettingDefinition(category, key);
      if (!setting?.sensitive) return true;
      return !(typeof value === "string" && value === SECRET_MASK);
    });

    if (effectiveEntries.length === 0) {
      throw new ApiError(400, "No settings provided to update");
    }

    await prisma.$transaction(
      effectiveEntries.map(([key, value]) => {
        const def = getSettingDefinition(category, key)!;
        // Host-level settings are always written at the instance scope: that
        // is the only scope the consuming services read, and keeping them
        // here stops a tenant row from shadowing the shared resource.
        const scope = def.instanceScoped ? "" : organizationId;
        return prisma.systemSetting.upsert({
          where: { organizationId_category_key: { organizationId: scope, category, key } },
          update: { value: value as Prisma.InputJsonValue, updatedBy: actorId ?? null },
          create: {
            organizationId: scope,
            category,
            key,
            label: def.label,
            description: def.description,
            value: value as Prisma.InputJsonValue,
            updatedBy: actorId ?? null,
          },
        });
      }),
    );

    invalidateCache();
    logger.info("Settings updated", {
      organizationId,
      category,
      keys: effectiveEntries.map(([key]) => key),
      userId: actorId,
    });
    return this.getByCategory(category, organizationId);
  },

  async reset(category: SystemSettingCategory, actorId?: string, organizationId = ""): Promise<SerializedSetting[]> {
    const definition = getSettingCategory(category);
    if (!definition) {
      throw new ApiError(400, `Unknown settings category "${category}"`);
    }

    // A tenant reset only drops its own overrides; host-level rows are shared
    // with every other organization and belong to the instance, so the
    // instance-wide branch below is the only one that may touch them.
    const orgSettings = definition.settings.filter((def) => !def.instanceScoped);

    if (organizationId !== "") {
      // Organization-scoped settings reset by reverting the tenant's own
      // overrides so they fall back to the instance-wide baselines.
      await prisma.systemSetting.deleteMany({
        where: { organizationId, category, key: { in: orgSettings.map((def) => def.key) } },
      });
    } else {
      await prisma.$transaction(
        definition.settings.map((def) =>
          prisma.systemSetting.upsert({
            where: { organizationId_category_key: { organizationId: "", category, key: def.key } },
            update: { value: def.defaultValue as Prisma.InputJsonValue, updatedBy: actorId ?? null },
            create: {
              organizationId: "",
              category,
              key: def.key,
              label: def.label,
              description: def.description,
              value: def.defaultValue as Prisma.InputJsonValue,
              updatedBy: actorId ?? null,
            },
          }),
        ),
      );
    }

    invalidateCache();
    logger.info("Settings reset to defaults", { organizationId, category, userId: actorId });
    return this.getByCategory(category, organizationId);
  },

  async getValue(category: SystemSettingCategory, key: string, organizationId = ""): Promise<SettingValue | undefined> {
    // Host-level settings are resolved at the instance scope no matter which
    // organization asked, so a caller can never observe a tenant row for the
    // shared media root, quota or retention policy.
    const scope = isInstanceScopedSetting(category, key) ? "" : organizationId;
    const rows = await loadAll(scope);
    const row = rows.find((r) => r.category === category && r.key === key);
    if (row) return row.value as SettingValue;
    return getSettingDefinition(category, key)?.defaultValue;
  },

  clearCache() {
    invalidateCache();
  },
};
