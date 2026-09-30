/**
 * Host-level settings scope -- media root, quota and retention policy.
 *
 * `camera.service.ts`, `health.service.ts`, `mediaPrune.service.ts` and
 * `retentionScheduler.ts` all read the storage and retention settings through
 * the instance scope (the default ""), while the settings controller used to
 * write every non-security category at the caller's organization. So a tenant
 * admin could edit `storage_base_path` and the change was accepted, audited
 * and displayed, yet nothing ever read it -- the instance kept using the
 * default path. Worse, the reverse direction was a latent path hazard: had
 * the reads been "fixed" to the organization scope instead, a tenant could
 * have pointed snapshot capture and the prune tool at a path of its choosing.
 *
 * These tests pin the resolution to the instance scope, which is where the
 * values are consumed, gate those keys to Super Admins like the security
 * settings, and pin the write-time rejection of a root-like media root.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

type Row = {
  organizationId: string;
  category: string;
  key: string;
  value: unknown;
  label?: string;
  description?: string;
  updatedBy: string | null;
  updatedAt: Date;
};

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  upsert: vi.fn(),
  deleteMany: vi.fn(async () => ({ count: 0 })),
  createMany: vi.fn(async () => ({ count: 0 })),
  findMany: vi.fn(),
}));

vi.mock("../src/config/prisma", () => ({
  prisma: {
    systemSetting: {
      findMany: h.findMany,
      upsert: h.upsert,
      deleteMany: h.deleteMany,
      createMany: h.createMany,
      update: vi.fn(async () => ({})),
    },
    $transaction: async (ops: unknown) => {
      const list = Array.isArray(ops) ? ops : [ops];
      for (const op of list) await op;
      return list;
    },
  },
}));

vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { settingsService } from "../src/services/settings.service";

const ORG = "org-tenant-a";

function row(organizationId: string, category: string, key: string, value: unknown): Row {
  return {
    organizationId,
    category,
    key,
    value,
    label: key,
    description: key,
    updatedBy: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

beforeEach(() => {
  h.rows = [];
  h.upsert.mockReset();
  h.deleteMany.mockClear();
  h.findMany.mockReset();
  // The real query is always scope-filtered; honour `where.organizationId` so
  // the instance lookup cannot accidentally see tenant rows (and vice versa).
  h.findMany.mockImplementation(
    async (args?: { where?: { organizationId?: string | { not: string }; updatedBy?: null } }) => {
      const where = args?.where;
      if (where?.organizationId === undefined) return h.rows;
      if (typeof where.organizationId === "string") {
        return h.rows.filter((r) => r.organizationId === where.organizationId);
      }
      return h.rows.filter((r) => r.organizationId !== where.organizationId.not);
    },
  );
  settingsService.clearCache();
});

describe("instance-scoped setting definitions", () => {
  it("marks the host-level media settings as instance-wide", async () => {
    const { isInstanceScopedSetting } = await import("../src/settings");
    for (const key of [
      "storage_base_path",
      "max_storage_gb",
      "low_storage_threshold_gb",
      "cleanup_interval_days",
      "report_retention_days",
    ]) {
      expect(isInstanceScopedSetting("storage", key)).toBe(true);
    }
    expect(isInstanceScopedSetting("ai_detection", "image_retention_days")).toBe(true);
    expect(isInstanceScopedSetting("ai_detection", "video_retention_days")).toBe(true);
    expect(isInstanceScopedSetting("ai_detection", "auto_cleanup_enabled")).toBe(true);
  });

  it("leaves per-tenant settings organization-scoped", async () => {
    const { isInstanceScopedSetting } = await import("../src/settings");
    expect(isInstanceScopedSetting("storage", "scheduled_reports_enabled")).toBe(false);
    expect(isInstanceScopedSetting("storage", "report_cadence_days")).toBe(false);
    expect(isInstanceScopedSetting("notifications", "webhook_url")).toBe(false);
    expect(isInstanceScopedSetting("general", "system_name")).toBe(false);
  });
});

describe("reading host-level settings", () => {
  it("resolves the media root from the instance scope, ignoring a tenant row", async () => {
    h.rows = [row("", "storage", "storage_base_path", "/data/vigilens")];

    expect(await settingsService.getValue("storage", "storage_base_path", ORG)).toBe("/data/vigilens");
    expect(await settingsService.getValue("storage", "storage_base_path")).toBe("/data/vigilens");
  });

  it("resolves retention and quota from the instance scope for a tenant", async () => {
    h.rows = [
      row("", "storage", "max_storage_gb", 250),
      row("", "ai_detection", "image_retention_days", 14),
    ];

    expect(await settingsService.getValue("storage", "max_storage_gb", ORG)).toBe(250);
    expect(await settingsService.getValue("ai_detection", "image_retention_days", ORG)).toBe(14);
  });

  it("overlays instance values onto a tenant category view", async () => {
    h.rows = [
      row("", "storage", "storage_base_path", "/srv/media"),
      row("", "storage", "max_storage_gb", 250),
      row(ORG, "storage", "storage_base_path", "/tmp/tenant-escape"),
      row(ORG, "storage", "scheduled_reports_enabled", true),
    ];

    const rows = await settingsService.getByCategory("storage", ORG);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    expect(byKey.get("storage_base_path")).toBe("/srv/media");
    expect(byKey.get("max_storage_gb")).toBe(250);
    // The tenant still owns its own scheduled-report settings.
    expect(byKey.get("scheduled_reports_enabled")).toBe(true);
  });

  it("still returns tenant overrides for organization-scoped settings", async () => {
    h.rows = [row(ORG, "notifications", "webhook_url", "https://tenant.example/hook")];

    expect(await settingsService.getValue("notifications", "webhook_url", ORG)).toBe(
      "https://tenant.example/hook",
    );
  });

  it("falls back to the code default when no row exists", async () => {
    expect(await settingsService.getValue("storage", "storage_base_path", ORG)).toBe("/data/vigilens");
  });
});

describe("writing host-level settings", () => {
  it("persists a host-level value at the instance scope", async () => {
    h.upsert.mockImplementation(async (args) => args);
    h.rows = [row("", "storage", "storage_base_path", "/srv/media")];

    await settingsService.update("storage", { storage_base_path: "/srv/media" }, "user-1", ORG);

    expect(h.upsert).toHaveBeenCalledTimes(1);
    const arg = h.upsert.mock.calls[0][0] as {
      where: { organizationId_category_key: { organizationId: string } };
      create: { organizationId: string };
    };
    expect(arg.where.organizationId_category_key.organizationId).toBe("");
    expect(arg.create.organizationId).toBe("");
  });

  it("persists a tenant-owned value at the organization scope", async () => {
    h.upsert.mockImplementation(async (args) => args);
    h.rows = [row(ORG, "storage", "report_cadence_days", "7")];

    await settingsService.update("storage", { report_cadence_days: "7" }, "user-1", ORG);

    const arg = h.upsert.mock.calls[0][0] as {
      where: { organizationId_category_key: { organizationId: string } };
    };
    expect(arg.where.organizationId_category_key.organizationId).toBe(ORG);
  });

  it("splits a mixed-category write across both scopes", async () => {
    h.upsert.mockImplementation(async (args) => args);
    h.rows = [
      row("", "storage", "storage_base_path", "/srv/media"),
      row(ORG, "storage", "scheduled_reports_enabled", true),
    ];

    await settingsService.update(
      "storage",
      { storage_base_path: "/srv/media", scheduled_reports_enabled: true },
      "user-1",
      ORG,
    );

    const scopes = h.upsert.mock.calls.map(
      (call) => (call[0] as { where: { organizationId_category_key: { organizationId: string } } })
        .where.organizationId_category_key.organizationId,
    );
    expect(scopes.sort()).toEqual(["", ORG].sort());
  });

  it("rejects a root-like media root instead of storing it", async () => {
    for (const bad of ["/", "C:\\", "  ", ""]) {
      await expect(
        settingsService.update("storage", { storage_base_path: bad }, "user-1", ORG),
      ).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("accepts an ordinary media root", async () => {
    h.upsert.mockImplementation(async (args) => args);
    h.rows = [row("", "storage", "storage_base_path", "/srv/media")];

    await expect(
      settingsService.update("storage", { storage_base_path: "/srv/media" }, "user-1", ORG),
    ).resolves.toBeTruthy();
  });
});

describe("resetting host-level settings", () => {
  it("does not let a tenant reset delete shared rows", async () => {
    await settingsService.reset("storage", "user-1", ORG);

    expect(h.deleteMany).toHaveBeenCalledTimes(1);
    const arg = h.deleteMany.mock.calls[0][0] as {
      where: { organizationId: string; key: { in: string[] } };
    };
    expect(arg.where.organizationId).toBe(ORG);
    expect(arg.where.key.in).not.toContain("storage_base_path");
    expect(arg.where.key.in).not.toContain("max_storage_gb");
    expect(arg.where.key.in).toContain("scheduled_reports_enabled");
  });

  it("restores every key in the category when the instance resets", async () => {
    h.upsert.mockImplementation(async (args) => args);
    h.rows = [row("", "storage", "storage_base_path", "/data/vigilens")];

    await settingsService.reset("storage", "user-1");

    const keys = h.upsert.mock.calls.map(
      (call) => (call[0] as { where: { organizationId_category_key: { key: string } } })
        .where.organizationId_category_key.key,
    );
    expect(keys).toContain("storage_base_path");
    expect(keys).toContain("max_storage_gb");
  });
});

describe("ensureDefaults", () => {
  it("removes tenant copies of instance-wide settings", async () => {
    h.createMany.mockResolvedValue({ count: 0 });
    // Left over from before these keys were recognized as instance-wide.
    h.rows = [
      row(ORG, "storage", "storage_base_path", "/tmp/tenant-escape"),
      row(ORG, "ai_detection", "auto_cleanup_enabled", false),
      row(ORG, "storage", "report_cadence_days", "7"),
    ];

    await settingsService.ensureDefaults();

    expect(h.deleteMany).toHaveBeenCalledTimes(1);
    const arg = h.deleteMany.mock.calls[0][0] as {
      where: { organizationId: { not: string }; OR: Array<{ category: string; key: string }> };
    };
    expect(arg.where.organizationId).toEqual({ not: "" });
    expect(arg.where.OR).toEqual([
      { category: "storage", key: "storage_base_path" },
      { category: "ai_detection", key: "auto_cleanup_enabled" },
    ]);
  });

  it("leaves tenant-owned settings alone", async () => {
    h.createMany.mockResolvedValue({ count: 0 });
    h.rows = [row(ORG, "storage", "report_cadence_days", "7")];

    await settingsService.ensureDefaults();

    expect(h.deleteMany).not.toHaveBeenCalled();
  });
});