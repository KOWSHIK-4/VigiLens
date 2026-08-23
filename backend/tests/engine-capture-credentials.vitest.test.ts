import { describe, it, expect } from "vitest";
import {
  buildAuthenticatedSourceUrl,
  type AiServiceClient,
  type AiImageDetectionResponse,
} from "../src/engine/aiClient";
import { AiServiceFrameCaptureStage } from "../src/engine/capture";
import type { FrameInput, PipelineContext } from "../src/engine/types";

const credentials = { username: "stream user", password: "p@ss word" };

describe("buildAuthenticatedSourceUrl", () => {
  it("embeds userinfo into rtsp urls", () => {
    const out = buildAuthenticatedSourceUrl("rtsp://cam.example.com/live", "rtsp", credentials);
    expect(out).toBe("rtsp://stream%20user:p%40ss%20word@cam.example.com/live");
  });

  it("overrides existing userinfo", () => {
    const out = buildAuthenticatedSourceUrl("rtsp://old:old@cam.example.com/live", "rtsp", credentials);
    expect(out).toContain("stream%20user:");
    expect(out).not.toContain("old:old@");
  });

  it("applies to http and https sources", () => {
    const http = buildAuthenticatedSourceUrl("http://cam.example.com/snapshot.jpg", "ip", credentials);
    const https = buildAuthenticatedSourceUrl("https://cam.example.com/mjpeg", "ip", credentials);
    expect(http).toContain("@cam.example.com");
    expect(https).toContain("@cam.example.com");
  });

  it("leaves usb indexes untouched", () => {
    expect(buildAuthenticatedSourceUrl("0", "usb", credentials)).toBe("0");
  });

  it("leaves video file paths untouched", () => {
    expect(buildAuthenticatedSourceUrl("/recordings/demo.mp4", "video_file", credentials)).toBe(
      "/recordings/demo.mp4",
    );
  });

  it("returns the source unchanged without credentials", () => {
    const source = "rtsp://cam.example.com/live";
    expect(buildAuthenticatedSourceUrl(source, "rtsp")).toBe(source);
  });

  it("returns the source unchanged when credentials are incomplete", () => {
    const source = "rtsp://cam.example.com/live";
    expect(buildAuthenticatedSourceUrl(source, "rtsp", { username: "u", password: "" })).toBe(source);
  });
});

class RecordingCaptureClient implements AiServiceClient {
  lastSource: string | null = null;
  lastCredentials: unknown;

  async detectImage(): Promise<AiImageDetectionResponse> {
    throw new Error("not used in this test");
  }

  async captureFrame(
    source: string,
    _cameraType: string,
    _videoPosSeconds?: number,
    _timeoutMs?: number,
    creds?: { username: string; password: string },
  ): Promise<Buffer> {
    this.lastSource = source;
    this.lastCredentials = creds;
    return Buffer.from("frame-bytes");
  }

  async isReachable(): Promise<boolean> {
    return true;
  }
}

function frameContext(frame: FrameInput): PipelineContext {
  return {
    detector: {
      id: "det-1",
      key: "person",
      name: "Person",
      version: "1",
      status: "ready",
      enabled: true,
      availability: "available",
      configuration: {} as PipelineContext["detector"]["configuration"],
      runtimeStatus: "ready",
    },
    cameraId: frame.cameraId,
    frameNumber: 1,
    startedAt: [0, 0],
    stageTimes: {},
    frame,
  };
}

describe("AiServiceFrameCaptureStage", () => {
  it("passes stored source credentials to the AI client", async () => {
    const client = new RecordingCaptureClient();
    const stage = new AiServiceFrameCaptureStage(client);
    await stage.process(
      {
        cameraId: "demo-camera-1",
        detectorId: "det-1",
        image: Buffer.alloc(0),
        frameNumber: 1,
        source: {
          url: "rtsp://cam.example.com/live",
          cameraType: "rtsp",
          username: "stream user",
          password: "p@ss word",
        },
      },
      frameContext({
        cameraId: "demo-camera-1",
        detectorId: "det-1",
        image: Buffer.alloc(0),
        frameNumber: 1,
      }),
    );
    expect(client.lastCredentials).toEqual({ username: "stream user", password: "p@ss word" });
    // The stage hands through the raw source; the client embeds userinfo
    // (covered by the buildAuthenticatedSourceUrl tests above).
    expect(client.lastSource).toBe("rtsp://cam.example.com/live");
  });

  it("captures without credentials when the source has none", async () => {
    const client = new RecordingCaptureClient();
    const stage = new AiServiceFrameCaptureStage(client);
    await stage.process(
      {
        cameraId: "demo-camera-1",
        detectorId: "det-1",
        image: Buffer.alloc(0),
        frameNumber: 1,
        source: { url: "rtsp://cam.example.com/live", cameraType: "rtsp" },
      },
      frameContext({
        cameraId: "demo-camera-1",
        detectorId: "det-1",
        image: Buffer.alloc(0),
        frameNumber: 1,
      }),
    );
    expect(client.lastSource).toBe("rtsp://cam.example.com/live");
    expect(client.lastCredentials).toBeUndefined();
  });
});
