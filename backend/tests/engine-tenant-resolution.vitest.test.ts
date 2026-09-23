import { describe, it, expect } from "vitest";
import { resolveProcessingCamera } from "../src/engine/resolveCamera";
import { ApiError } from "../src/utils/errors";

type FindFirst = (args: Record<string, unknown>) => Promise<{ id: string } | null>;

const orgACameras = [{ id: "cam-a-1" }, { id: "cam-a-2" }];
const orgBCameras = [{ id: "cam-b-1" }];

function inMemoryScoped(orgId: string, cameras: Array<{ id: string }>): FindFirst {
  return async (args) => {
    const where = args.where as { id?: string; organizationId?: string };
    const candidates = cameras.filter(
      (c) => where.organizationId === undefined || where.organizationId === orgId,
    );
    const row = where.id ? candidates.find((c) => c.id === where.id) : candidates[0];
    return row ?? null;
  };
}

describe("engine processing camera resolution (tenant scope)", () => {
  it("resolves an owned camera id for the caller organization", async () => {
    const id = await resolveProcessingCamera(inMemoryScoped("org-a", orgACameras), "org-a", "cam-a-1");
    expect(id).toBe("cam-a-1");
  });

  it("rejects a foreign camera id with 404", async () => {
    await expect(
      resolveProcessingCamera(inMemoryScoped("org-a", orgACameras), "org-a", "cam-b-1"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rejects an unknown camera id with 404 even when requested by the owner org", async () => {
    await expect(
      resolveProcessingCamera(inMemoryScoped("org-b", orgBCameras), "org-b", "cam-a-1"),
    ).rejects.toThrowError(ApiError);
    await expect(
      resolveProcessingCamera(inMemoryScoped("org-b", orgBCameras), "org-b", "cam-a-1"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("falls back to a camera inside the caller's organization only", async () => {
    const id = await resolveProcessingCamera(inMemoryScoped("org-a", orgACameras), "org-a");
    expect(orgACameras.map((c) => c.id)).toContain(id);
    expect(orgBCameras.map((c) => c.id)).not.toContain(id);
  });

  it("falls back to tenant B's own camera, never tenant A's", async () => {
    const id = await resolveProcessingCamera(inMemoryScoped("org-b", orgBCameras), "org-b");
    expect(id).toBe("cam-b-1");
  });

  it("returns 400 when the caller organization has no cameras", async () => {
    await expect(
      resolveProcessingCamera(inMemoryScoped("org-c", []), "org-c"),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("never resolves a requested camera when the organization does not match", async () => {
    await expect(
      resolveProcessingCamera(inMemoryScoped("org-b", orgBCameras), "org-b", "cam-a-1"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});