/**
 * Camera `sourceURL` handling.
 *
 * The source URL is the public-facing stream address the browser loads
 * directly in an <img>, and it is the one camera field that was not scrubbed:
 * `url` got userinfo stripped on write and on read, `sourceURL` did not. An
 * operator pasting `rtsp://admin:hunter2@cam.local/stream` into the override
 * field got the password stored in plaintext and echoed back on every camera
 * read. The schema also accepted any scheme `z.string().url()` recognises.
 */

import { describe, expect, it } from "vitest";
import { createCameraSchema, updateCameraSchema } from "../src/types";

const BASE = {
  name: "Gate",
  url: "rtsp://cam.local/stream",
  cameraType: "rtsp" as const,
};

describe("camera sourceURL validation", () => {
  it("accepts the schemes a real stream can use", () => {
    for (const sourceURL of [
      "https://proxy.example.com/stream",
      "http://proxy.example.com/stream",
      "rtsp://cam.local/live",
    ]) {
      const result = createCameraSchema.safeParse({ ...BASE, sourceURL });
      expect(result.success, sourceURL).toBe(true);
    }
  });

  it("still accepts a camera with no source URL override", () => {
    expect(createCameraSchema.safeParse({ ...BASE, sourceURL: null }).success).toBe(true);
    expect(createCameraSchema.safeParse(BASE).success).toBe(true);
  });

  it("rejects schemes that are never a stream", () => {
    for (const sourceURL of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,<script>alert(1)</script>",
      "gopher://127.0.0.1:11211/",
    ]) {
      const result = createCameraSchema.safeParse({ ...BASE, sourceURL });
      expect(result.success, sourceURL).toBe(false);
    }
  });

  it("rejects a relative or malformed value", () => {
    expect(createCameraSchema.safeParse({ ...BASE, sourceURL: "/stream" }).success).toBe(false);
    expect(createCameraSchema.safeParse({ ...BASE, sourceURL: "not a url" }).success).toBe(false);
  });

  it("enforces the same rule on update", () => {
    expect(updateCameraSchema.safeParse({ sourceURL: "https://proxy.example.com/s" }).success).toBe(true);
    expect(updateCameraSchema.safeParse({ sourceURL: "javascript:alert(1)" }).success).toBe(false);
  });

  it("rejects a source URL beyond the length cap", () => {
    const long = `https://proxy.example.com/${"a".repeat(2100)}`;
    expect(createCameraSchema.safeParse({ ...BASE, sourceURL: long }).success).toBe(false);
  });
});

describe("stripUrlUserinfo on a source URL", () => {
  it("removes the credential and keeps the feed", async () => {
    const { stripUrlUserinfo } = await import("../src/utils/redact");
    expect(stripUrlUserinfo("rtsp://admin:hunter2@cam.local/stream")).toBe("rtsp://cam.local/stream");
    expect(stripUrlUserinfo("https://user@proxy.example.com/s")).toBe("https://proxy.example.com/s");
  });

  it("leaves a credential-free URL untouched", async () => {
    const { stripUrlUserinfo } = await import("../src/utils/redact");
    const url = "https://proxy.example.com/stream";
    expect(stripUrlUserinfo(url)).toBe(url);
  });
});
