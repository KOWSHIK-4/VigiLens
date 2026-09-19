import { prisma } from "../config/prisma";

import type { SearchEntityType, SearchSection, SearchResult } from "./globalSearch.definitions";
import {
  SEARCH_ENTITIES,
  buildSearchWhere,
  resolveSearchTypes,
  trimToPermissions,
  SEARCH_TYPE_LABELS,
  SEARCH_TYPE_PERMISSIONS,
} from "./globalSearch.definitions";

const SEARCH_RESULT_LIMIT_CAP = 50;

interface EntityLookup {
  /** Prisma string model name (used for dynamic delegate access). */
  model: string;
  /** Field that always exists and is used for stable ordering. */
  orderField: string;
}

const LOOKUPS: Record<SearchEntityType, EntityLookup> = {
  detections: { model: "detection", orderField: "timestamp" },
  alerts: { model: "alert", orderField: "createdAt" },
  incidents: { model: "incident", orderField: "createdAt" },
  cameras: { model: "camera", orderField: "createdAt" },
  audit: { model: "auditLog", orderField: "timestamp" },
  users: { model: "user", orderField: "createdAt" },
};

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 10;
  return Math.min(Math.floor(limit), SEARCH_RESULT_LIMIT_CAP);
}

async function queryEntity(
  entity: SearchEntityType,
  term: string,
  limit: number,
): Promise<{ count: number; results: SearchResult[] }> {
  const take = clampLimit(limit);
  const spec = SEARCH_ENTITIES[entity];
  const where = buildSearchWhere(spec, term);
  const { model, orderField } = LOOKUPS[entity];
  const delegate = (prisma as unknown as Record<string, unknown>)[model] as {
    findMany: (opts: unknown) => Promise<Array<Record<string, unknown>>>;
    count: (opts: unknown) => Promise<number>;
  };

  const [rows, count] = await Promise.all([
    delegate.findMany({ where, orderBy: { [orderField]: "desc" }, take }),
    delegate.count({ where }),
  ]);

  const results = rows.map((row) => {
    const normalized =
      entity === "detections"
        ? {
            ...row,
            cameraName: (row.camera as { name?: string } | null)?.name ?? row.cameraId,
          }
        : row;
    return spec.toResult(normalized);
  });

  return { count, results };
}

export interface GlobalSearchResult {
  query: string;
  sections: SearchSection[];
  totalMatches: number;
  searchedTypes: SearchEntityType[];
}

export const globalSearchService = {
  async search(params: {
    term: string;
    type?: string;
    limit?: number;
    permissions?: Set<string>;
  }): Promise<GlobalSearchResult> {
    const term = params.term.trim();
    const limit = clampLimit(params.limit ?? 10);
    const types = resolveSearchTypes(params.type);

    if (!types.length) {
      return { query: term, sections: [], totalMatches: 0, searchedTypes: [] };
    }

    const sectionEntries: SearchSection[] = await Promise.all(
      types.map(async (entity) => {
        const { count, results } = await queryEntity(entity, term, limit);
        return {
          type: entity,
          label: SEARCH_TYPE_LABELS[entity],
          permission: SEARCH_TYPE_PERMISSIONS[entity],
          count,
          results,
        };
      }),
    );

    const sections = trimToPermissions(sectionEntries, params.permissions);
    return {
      query: term,
      sections,
      totalMatches: sections.reduce((sum, s) => sum + s.count, 0),
      searchedTypes: [...Object.keys(LOOKUPS) as SearchEntityType[]],
    };
  },
};

export { SEARCH_RESULT_LIMIT_CAP };