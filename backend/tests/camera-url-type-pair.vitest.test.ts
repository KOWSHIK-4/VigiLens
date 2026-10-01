/**
 * The camera type/URL pair cannot be desynchronized by a partial update.
 *
 * `createCameraSchema` carries a refine that checks the URL against the scheme
 * its declared `cameraType` requires. `updateCameraSchema` was only
 * `cameraBaseSchema.partial()` plus a non-empty check, so the refine was
 * dropped on update: PATCH { cameraType: "rtsp" } against a camera stored as
 * `ip` left a row whose type and URL cannot both be true, and the service wrote
 * both fields without re-checking them against each other.
 */

import { describe, expect, it, vi } from "vitest";
import {
  checkCameraUrlForType,
  createCameraSchema,
  updateCameraSchema,
} from "../src/types";

const BASE = { name: "Gate", url: "rtsp://cam.local/stream", cameraType: "rtsp" as const };

describe("checkCameraUrlForType", () => {
  it("accepts a URL that satisfies its declared type", () => {
    expect(checkCameraUrlForType("rtsp://cam.local/s", "rtsp").ok).toBe(true);
    expect(checkCameraUrlForType("http://10.0.0.5/stream", "ip").ok).toBe(true);
    expect(checkCameraUrlForType("https://10.0.0.5/stream", "ip").ok).toBe(true);
    expect(checkCameraUrlForType("/dev/video0", "usb").ok).toBe(true);
    expect(checkCameraUrlForType("D:\\capture\\gate.mp4", "video_file").ok).toBe(true);
    expect(checkCameraUrlForType("/data/clip.mkv", "video_file").ok).toBe(true);
  });

  it("rejects a URL that contradicts its declared type", () => {
    for (const [url, cameraType] of [
      ["http://169.254.169.254/latest/", "rtsp"],
      ["rtsp://cam.local/s", "ip"],
      ["http://10.0.0.5/s", "video_file"],
      ["/data/clip.mp4", "usb"],
    ] as const) {
      expect(checkCameraUrlForType(url, cameraType).ok, `${cameraType}:${url}`).toBe(false);
    }
  });
});

describe("create path keeps the rule", () => {
  it("still rejects a URL that contradicts the type", () => {
    expect(createCameraSchema.safeParse({ ...BASE, url: "http://10.0.0.5/s" }).success).toBe(false);
    expect(createCameraSchema.safeParse(BASE).success).toBe(true);
  });
});

describe("update schema accepts partial bodies", () => {
  it("still rejects an empty update", () => {
    expect(updateCameraSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a url-only or type-only body, leaving the pair check to the service", () => {
    expect(updateCameraSchema.safeParse({ url: "rtsp://other.local/s" }).success).toBe(true);
    expect(updateCameraSchema.safeParse({ cameraType: "ip" }).success).toBe(true);
  });
});

describe("cameraService.update validates the merged type and URL", () => {
  async function loadUpdateService(stored: { cameraType: string; url: string }) {
    vi.resetModules();
    const update = vi.fn().mockResolvedValue({ id: "cam-1", ...stored });
    vi.doMock("../src/config/prisma", () => ({
      prisma: {
        camera: {
          findFirst: vi.fn().mockResolvedValue({
            id: "cam-1",
            name: "Gate",
            ...stored,
          }),
          findUnique: vi.fn().mockResolvedValue(null),
          update,
        },
      },
    }));
    const { cameraService } = await import("../src/services/camera.service");
    return { cameraService, update };
  }

  it("refuses to store an rtsp type against a stored http url", async () => {
    const { cameraService, update } = await loadUpdateService({
      cameraType: "ip",
      url: "http://10.0.0.5/stream",
    });

    await expect(
      cameraService.update("cam-1", { cameraType: "rtsp" as never }, "org-1"),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CAMERA_URL" });

    expect(update).not.toHaveBeenCalled();
  });

  it("refuses to repoint a camera at an arbitrary host under the wrong type", async () => {
    const { cameraService, update } = await loadUpdateService({
      cameraType: "rtsp",
      url: "rtsp://cam.local/stream",
    });

    await expect(
      cameraService.update("cam-1", { url: "169.254.169.254" }, "org-1"),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_CAMERA_URL" });

    expect(update).not.toHaveBeenCalled();
  });

  it("accepts a url that matches the stored type", async () => {
    const { cameraService, update } = await loadUpdateService({
      cameraType: "rtsp",
      url: "rtsp://cam.local/stream",
    });

    await cameraService.update("cam-1", { url: "rtsp://cam2.local/stream" }, "org-1");

    expect(update).toHaveBeenCalledTimes(1);
  });

  it("accepts a type-only update when the stored url already satisfies it", async () => {
    const { cameraService, update } = await loadUpdateService({
      cameraType: "rtsp",
      url: "rtsp://cam.local/stream",
    });

    await cameraService.update("cam-1", { cameraType: "rtsp" as never }, "org-1");

    expect(update).toHaveBeenCalledTimes(1);
  });
});