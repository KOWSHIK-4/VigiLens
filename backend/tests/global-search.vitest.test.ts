/**
 * Global search — unit tests.
 *
 * Pure layer: query shaping, type resolution, permission trimming and result
 * mapping in globalSearch.definitions. Service layer: delegate plumbing with
 * the Prisma client stubbed at module level.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const fakeRows: Record<string, Array<Record<string, unknown>>> = {
  detection: [
    {
      id: "dt-1",
      label: "person",
      className: "person",
      detectorKey: "person",
      confidence: 0.9,
      status: "warning",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      cameraId: "cam-1",
      camera: { name: "Main" },
    },
  ],
  alert: [],
  incident: [],
  camera: [
    {
      id: "cam-1",
      name: "Front Gate",
      location: "Entrance",
      status: "online",
      cameraType: "ip",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
  auditLog: [],
  user: [],
};

const clone = <T>(value: T): T => (Array.isArray(value) ? ([...value] as T) : value);

vi.mock("../src/config/prisma", () => {
  const makeDelegate = (model: keyof typeof fakeRows) => ({
    findMany: vi.fn(async ({ where }: { where: unknown }) => {
      void where;
      return clone(fakeRows[model]);
    }),
    count: vi.fn(async () => fakeRows[model].length),
  });
  return {
    prisma: {
      detection: makeDelegate("detection"),
      alert: makeDelegate("alert"),
      incident: makeDelegate("incident"),
      camera: makeDelegate("camera"),
      auditLog: makeDelegate("auditLog"),
      user: makeDelegate("user"),
    },
  };
});

import {
  buildSearchWhere,
  resolveSearchTypes,
  trimToPermissions,
  SEARCH_ENTITIES,
  SEARCH_TYPE_PERMISSIONS,
} from "../src/services/globalSearch.definitions";
import { globalSearchService } from "../src/services/globalSearch.service";

describe("globalSearch.definitions (pure)", () => {
  it("exposes every entity with a display label and a valid RBAC permission", () => {
    for (const type of Object.keys(SEARCH_ENTITIES) as Array<keyof typeof SEARCH_ENTITIES>) {
      expect(SEARCH_TYPE_PERMISSIONS[type]).toMatch(/\.(read)$/);
    }
  });

  it("builds case-insensitive OR-matrices for the configured fields", () => {
    const where = buildSearchWhere(SEARCH_ENTITIES.alerts, "  intruder  ");
    expect(where.OR).toEqual([
      { title: { contains: "intruder", mode: "insensitive" } },
      { message: { contains: "intruder", mode: "insensitive" } },
    ]);
  });

  it("resolves type filters, defaulting to all entities", () => {
    const all = Object.keys(SEARCH_ENTITIES).length;
    expect(resolveSearchTypes(undefined)).toHaveLength(all);
    expect(resolveSearchTypes("all")).toHaveLength(all);
    expect(resolveSearchTypes("detections")).toEqual(["detections"]);
    expect(resolveSearchTypes("feature-flags")).toEqual([]);
  });

  it("trims sections down to the caller's permissions", () => {
    const sections = [1, 2, 3].map((i) => ({
      type: `t${i}`,
      label: `T${i}`,
      permission: `p${i}`,
      count: i,
      results: [],
    }));
    const trimmed = trimToPermissions(sections, new Set(["p1", "p3"]));
    expect(trimmed.map((s) => s.type)).toEqual(["t1", "t3"]);
  });

  it("returns no sections when permissions are absent (defensive, not a bypass)", () => {
    const sections = [
      { type: "detections", label: "D", permission: "detections.read", count: 1, results: [] },
    ];
    expect(trimToPermissions(sections, undefined)).toEqual([]);
  });
});

describe("globalSearch.service (stubbed prisma)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps one section per searched type with counts and unified results", async () => {
    const result = await globalSearchService.search({
      term: "gate",
      type: "cameras",
      permissions: new Set(["cameras.read"]),
    });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].type).toBe("cameras");
    expect(result.sections[0].count).toBe(1);
    expect(result.sections[0].results[0].title).toBe("Front Gate");
    expect(result.totalMatches).toBe(1);
    expect(result.searchedTypes).toContain("cameras");
  });

  it("filters sections by permissions when searching all types", async () => {
    const result = await globalSearchService.search({
      term: "person",
      permissions: new Set(["detections.read"]),
    });
    expect(result.sections.map((s) => s.type)).toEqual(["detections"]);
    expect(result.sections[0].results[0].type).toBe("detections");
    expect(result.sections[0].results[0].title).toBe("person");
    expect(result.sections[0].results[0].subtitle).toContain("Main");
    expect(result.totalMatches).toBe(1);
  });

  it("returns an empty result set for an unknown type filter without throwing", async () => {
    const result = await globalSearchService.search({
      term: "zzz",
      type: "feature-flags",
      permissions: new Set(["alerts.read"]),
    });
    expect(result.sections).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.searchedTypes).toEqual([]);
  });

  it("caps backend work: one findMany + count per searched type", async () => {
    const prismaMock = (await import("../src/config/prisma")).prisma as Record<
      string,
      { findMany: ReturnType<typeof vi.fn> }
    >;
    const result = await globalSearchService.search({
      term: "x",
      type: "audit",
      permissions: new Set(["audit.read"]),
    });
    expect(result.sections[0].count).toBe(0);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.count).toHaveBeenCalledTimes(1);
  });
});