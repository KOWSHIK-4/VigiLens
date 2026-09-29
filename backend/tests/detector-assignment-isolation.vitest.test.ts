/**
 * Detector camera assignment — tenant isolation.
 *
 * AIModel has no organizationId, so a detector is one shared instance-wide
 * resource and the per-camera assignments hanging off it (DetectorCamera) are
 * the only place tenant ownership is recorded.
 *
 * assignCameras validates that the submitted cameraIds belong to the caller's
 * organization, and then reconciles the stored set inside a transaction. That
 * reconciliation used to delete *every* assignment row for the model:
 *
 *   prisma.detectorCamera.deleteMany({ where: { aiModelId: id } })
 *
 * So a tenant admin re-assigning its own cameras to a shared detector silently
 * removed every other tenant's cameras from that detector -- a cross-tenant
 * delete reached through a write that looked tenant-scoped. The validation
 * above it made the call look correctly scoped, which is what hid this.
 *
 * These tests pin the delete to the caller's organization, and pin the
 * super_admin (instance-wide) path to still replace the full set.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const deleteMany = vi.fn(async () => ({ count: 0 }));
  const createMany = vi.fn(async () => ({ count: 0 }));
  const cameraFindMany = vi.fn(async () => [] as unknown[]);
  const modelFindUnique = vi.fn(
    async () =>
      ({
        id: "model-1",
        name: "Person Detection",
        version: "1.0",
        description: "",
        detectorKey: "person",
        confidenceThreshold: 50,
        enabled: true,
        status: "active",
        gpuSupported: false,
        modelPath: "/models/person/yolo11n.pt",
        lastRestartAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        cameraAssignments: [],
      }) as unknown,
  );
  return { deleteMany, createMany, cameraFindMany, modelFindUnique };
});

// The factories are hoisted above every top-level `const`, so they reach the
// stubs through `h` rather than through destructured aliases.
vi.mock("../src/config/prisma", () => ({
  prisma: {
    $transaction: async (ops: unknown[]) => Promise.all(ops),
    detectorCamera: {
      deleteMany: h.deleteMany,
      createMany: h.createMany,
    },
    camera: { findMany: h.cameraFindMany },
    aIModel: { findUnique: h.modelFindUnique },
    detectorSettings: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ aiModelId: "model-1" })),
      upsert: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("../src/config/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { detectorService } from "../src/services/detector.service";

const ORG_A = "org-tenant-a";
const ORG_B = "org-tenant-b";

describe("assignCameras tenant isolation", () => {
  beforeEach(() => {
    h.deleteMany.mockClear();
    h.createMany.mockClear();
    h.cameraFindMany.mockClear();
    h.modelFindUnique.mockClear();
    // Default: the camera lookup resolves the caller's own cameras.
    h.cameraFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, name: `cam ${id}`, cameraType: "ip" as const })),
    );
  });

  it("scopes the assignment delete to the calling organization", async () => {
    await detectorService.assignCameras("model-1", { cameraIds: ["cam-1"] }, ORG_A);

    expect(h.deleteMany).toHaveBeenCalledTimes(1);
    const where = h.deleteMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where.where).toEqual({
      aiModelId: "model-1",
      camera: { organizationId: ORG_A },
    });
  });

  it("never deletes another organization's assignments", async () => {
    await detectorService.assignCameras("model-1", { cameraIds: ["cam-1"] }, ORG_A);

    const where = h.deleteMany.mock.calls[0][0] as { where: Record<string, unknown> };
    // The regression was an unscoped `where: { aiModelId }`, which matches rows
    // for every tenant. Assert the shape directly so a future "simplification"
    // back to it fails here rather than in production.
    expect(where.where.camera).toEqual({ organizationId: ORG_A });
    expect(Object.keys(where.where)).toContain("camera");
  });

  it("uses a different delete scope for two different tenants", async () => {
    await detectorService.assignCameras("model-1", { cameraIds: ["cam-1"] }, ORG_A);
    await detectorService.assignCameras("model-1", { cameraIds: ["cam-2"] }, ORG_B);

    const first = h.deleteMany.mock.calls[0][0] as { where: Record<string, unknown> };
    const second = h.deleteMany.mock.calls[1][0] as { where: Record<string, unknown> };
    expect(first.where.camera).toEqual({ organizationId: ORG_A });
    expect(second.where.camera).toEqual({ organizationId: ORG_B });
  });

  it("keeps replacing the full set for an instance admin", async () => {
    // No organizationId means a super_admin acting on the instance, which must
    // still be able to set the whole assignment list.
    await detectorService.assignCameras("model-1", { cameraIds: ["cam-1", "cam-2"] });

    const where = h.deleteMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where.where).toEqual({ aiModelId: "model-1" });
    expect(where.where.camera).toBeUndefined();
  });

  it("still writes only the caller's own cameras", async () => {
    await detectorService.assignCameras("model-1", { cameraIds: ["cam-1", "cam-2"] }, ORG_A);

    expect(h.createMany).toHaveBeenCalledTimes(1);
    const data = (h.createMany.mock.calls[0][0] as { data: unknown[] }).data;
    expect(data).toEqual([
      { aiModelId: "model-1", cameraId: "cam-1", enabled: true },
      { aiModelId: "model-1", cameraId: "cam-2", enabled: true },
    ]);
  });

  it("rejects a camera id from another organization before touching the delete", async () => {
    // Ownership is still validated upstream: a foreign camera id must fail the
    // camera lookup, so no reconciliation runs at all.
    h.cameraFindMany.mockResolvedValue([]);

    await expect(
      detectorService.assignCameras("model-1", { cameraIds: ["cam-foreign"] }, ORG_A),
    ).rejects.toThrow(/invalid/i);

    expect(h.deleteMany).not.toHaveBeenCalled();
    expect(h.createMany).not.toHaveBeenCalled();
  });
});
