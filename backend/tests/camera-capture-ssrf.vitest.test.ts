/**
 * The outbound camera-source guard on the frame-capture path.
 *
 * `probeHttpCamera` applied the SSRF guard, but the AI-service capture path did
 * not -- and that path is a broader surface, because the source reaches
 * `cv2.VideoCapture`/FFMPEG. Since the guard ran only for `ip` + http(s) rows,
 * every `rtsp` camera (the default type) reached the fetcher unchecked, and the
 * background scheduler dereferenced those sources with no API call at all.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { assertCameraSourceAllowed } from "../src/utils/ssrf";

describe("assertCameraSourceAllowed", () => {
  it("blocks the destinations that can never be a camera", () => {
    for (const source of [
      "rtsp://127.0.0.1:8554/live",
      "http://127.0.0.1:5432/",
      "rtsp://localhost:554/stream",
      "http://LOCALHOST/admin",
      "http://169.254.169.254/latest/meta-data/",
      "rtsp://169.254.169.254/latest/meta-data/",
      "http://[::1]:8080/",
      "http://[fd00:ec2::254]/latest/",
      "http://[fe80::1]/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://instance-data/latest/meta-data/",
    ]) {
      expect(assertCameraSourceAllowed(source).allowed, source).toBe(false);
    }
  });

  it("permits RTSP, which the HTTP-only guard would have rejected", () => {
    expect(assertCameraSourceAllowed("rtsp://cam.example.com:554/live").allowed).toBe(true);
    expect(assertCameraSourceAllowed("rtsps://cam.example.com:322/live").allowed).toBe(true);
  });

  it("still permits RFC1918 space, where on-prem cameras live", () => {
    expect(assertCameraSourceAllowed("rtsp://10.0.0.42:554/live").allowed).toBe(true);
    expect(assertCameraSourceAllowed("http://192.168.1.100/").allowed).toBe(true);
    expect(assertCameraSourceAllowed("rtsp://172.16.4.9/stream").allowed).toBe(true);
  });

  it("rejects schemes OpenCV would never legitimately open", () => {
    for (const source of [
      "file:///etc/passwd",
      "gopher://127.0.0.1:11211/",
      "data:text/html,<script>alert(1)</script>",
      "not a url",
      "",
    ]) {
      expect(assertCameraSourceAllowed(source).allowed, source).toBe(false);
    }
  });
});

/**
 * These tests drive `healthCheck` and `captureSnapshot` directly, with Prisma
 * mocked, so the assertion is behavioural: was the AI service client asked to
 * open a socket, yes or no.
 */
describe("camera capture paths enforce the guard", () => {
  let captureFrame: ReturnType<typeof vi.fn>;
  let healthLogs: Array<Record<string, unknown>>;

  beforeEach(() => {
    vi.resetModules();
    captureFrame = vi.fn().mockResolvedValue(Buffer.from("frame"));
    healthLogs = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function loadService(camera: Record<string, unknown>) {
    vi.doMock("../src/config/prisma", () => ({
      prisma: {
        camera: {
          findFirst: vi.fn().mockResolvedValue({ id: "cam-1", ...camera }),
          findUnique: vi.fn().mockResolvedValue(null),
          update: vi.fn().mockResolvedValue({ id: "cam-1", ...camera }),
        },
        cameraHealthLog: {
          create: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            healthLogs.push(row.data as Record<string, unknown>);
            return Promise.resolve({});
          }),
        },
      },
    }));

    const { cameraService } = await import("../src/services/camera.service");
    return cameraService;
  }

  it("does not ask the AI service to open a blocked rtsp source", async () => {
    const cameraService = await loadService({
      url: "rtsp://127.0.0.1:8554/live",
      cameraType: "rtsp",
      name: "Gate",
    });
    const client = { captureFrame } as never;

    await cameraService.healthCheck("cam-1", client, "org-1");

    expect(captureFrame).not.toHaveBeenCalled();
    expect(healthLogs).toEqual([
      expect.objectContaining({ status: "error", message: expect.stringContaining("blocked") }),
    ]);
  });

  it("does not ask the AI service to open a blocked metadata source", async () => {
    const cameraService = await loadService({
      url: "rtsp://169.254.169.254/latest/meta-data/",
      cameraType: "rtsp",
      name: "Gate",
    });
    const client = { captureFrame } as never;

    await cameraService.healthCheck("cam-1", client, "org-1");

    expect(captureFrame).not.toHaveBeenCalled();
  });

  it("still captures from a legitimate private rtsp camera", async () => {
    const cameraService = await loadService({
      url: "rtsp://10.0.0.42:554/live",
      cameraType: "rtsp",
      name: "Loading bay",
    });
    const client = { captureFrame } as never;

    await cameraService.healthCheck("cam-1", client, "org-1");

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(healthLogs).toEqual([expect.objectContaining({ status: "online" })]);
  });

  it("refuses a blocked source on the snapshot path", async () => {
    const cameraService = await loadService({
      url: "rtsp://127.0.0.1:8554/live",
      cameraType: "rtsp",
      name: "Gate",
    });
    const client = { captureFrame } as never;

    await expect(
      cameraService.captureSnapshot("cam-1", client, "/tmp/snap", "org-1"),
    ).rejects.toMatchObject({ statusCode: 422, code: "CAMERA_SOURCE_BLOCKED" });

    expect(captureFrame).not.toHaveBeenCalled();
  });

  it("leaves local device sources to the local path", async () => {
    const cameraService = await loadService({
      url: "/dev/video0",
      cameraType: "usb",
      name: "Lobby",
    });
    const client = { captureFrame } as never;

    await cameraService.healthCheck("cam-1", client, "org-1");

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(healthLogs).toEqual([expect.objectContaining({ status: "online" })]);
  });
});