import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import { ApiError } from "@/utils/errors";
import type {
  SettingDefinition,
  SettingValue,
  SettingsCategoryDefinition,
} from "@/settings";
import {
  getSettingCategories,
  getSettingCategory,
  getSettingDefinition,
  isValidSettingValue,
} from "@/settings";
import type { Prisma, SystemSetting, SystemSettingCategory } from "@prisma/client";

const CACHE_TTL_MS = 60_000;

interface CachedSettings {
  data: SystemSetting[];
  loadedAt: number;
}

let cachedAll: CachedSettings | null = null;

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
  updatedAt: string;
  updatedBy: string | null;
}

function serialize(
  category: SystemSettingCategory,
  def: SettingDefinition,
  row: SystemSetting | undefined,
): SerializedSetting {
  const value = (row?.value as SettingValue) ?? def.defaultValue;
  const result: SerializedSetting = {
    key: def.key,
    category,
    label: row?.label ?? def.label,
    description: row?.description ?? def.description,
    type: def.type,
    value,
    updatedAt: row?.updatedAt.toISOString() ?? new Date(0).toISOString(),
    updatedBy: row?.updatedBy ?? null,
  };
  if (def.min !== undefined) result.min = def.min;
  if (def.max !== undefined) result.max = def.max;
  if (def.step !== undefined) result.step = def.step;
  if (def.unit !== undefined) result.unit = def.unit;
  if (def.options !== undefined) result.options = def.options;
  return result;
}

async function loadAll(): Promise<SystemSetting[]> {
  if (cachedAll && Date.now() - cachedAll.loadedAt < CACHE_TTL_MS) {
    return cachedAll.data;
  }
  const rows = await prisma.systemSetting.findMany();
  cachedAll = { data: rows, loadedAt: Date.now() };
  return rows;
}

function invalidateCache() {
  cachedAll = null;
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
    return created;
  },

  async getAll(): Promise<SerializedSetting[]> {
    const rows = await loadAll();
    const serialized: SerializedSetting[] = [];
    for (const category of getSettingCategories()) {
      const byKey = settingMapFor(category, rows);
      for (const def of category.settings) {
        serialized.push(serialize(category.key, def, byKey.get(def.key)));
      }
    }
    return serialized;
  },

  async getByCategory(category: SystemSettingCategory): Promise<SerializedSetting[]> {
    const definition = getSettingCategory(category);
    if (!definition) {
      throw new ApiError(400, `Unknown settings category "${category}"`);
    }
    const rows = await loadAll();
    const byKey = settingMapFor(definition, rows);
    return definition.settings.map((def) => serialize(category, def, byKey.get(def.key)));
  },

  async update(
    category: SystemSettingCategory,
    values: Record<string, SettingValue>,
    actorId?: string,
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
    }

    await prisma.$transaction(
      entries.map(([key, value]) => {
        const def = getSettingDefinition(category, key)!;
        return prisma.systemSetting.upsert({
          where: { category_key: { category, key } },
          update: { value: value as Prisma.InputJsonValue, updatedBy: actorId ?? null },
          create: {
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
      category,
      keys: entries.map(([key]) => key),
      userId: actorId,
    });
    return this.getByCategory(category);
  },

  async reset(category: SystemSettingCategory, actorId?: string): Promise<SerializedSetting[]> {
    const definition = getSettingCategory(category);
    if (!definition) {
      throw new ApiError(400, `Unknown settings category "${category}"`);
    }

    await prisma.$transaction(
      definition.settings.map((def) =>
        prisma.systemSetting.upsert({
          where: { category_key: { category, key: def.key } },
          update: { value: def.defaultValue as Prisma.InputJsonValue, updatedBy: actorId ?? null },
          create: {
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

    invalidateCache();
    logger.info("Settings reset to defaults", { category, userId: actorId });
    return this.getByCategory(category);
  },

  async getValue(category: SystemSettingCategory, key: string): Promise<SettingValue | undefined> {
    const rows = await loadAll();
    const row = rows.find((r) => r.category === category && r.key === key);
    if (row) return row.value as SettingValue;
    return getSettingDefinition(category, key)?.defaultValue;
  },

  clearCache() {
    invalidateCache();
  },
};
