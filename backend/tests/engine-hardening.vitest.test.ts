/**
 * Detector Engine v2 — Reliability hardening unit tests.
 *
 * Focused on the AI client's error classification: empty frames, network
 * failures, timeouts, HTTP errors and malformed payloads must each produce
 * a typed `AiServiceError` so the engine can classify and recover.
 * No network or database is touched — fetch is stubbed.
 */

import { describe, it, expect, afterEach } from "vitest";
import { HttpAiServiceClient, AiServiceError } from "../src/engine/aiClient";

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("Engine Hardening", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("empty frame -> invalid_frame", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    await expect(client.detectImage(Buffer.alloc(0))).rejects.toThrow(
      expect.objectContaining({ reason: "invalid_frame" }),
    );
  });

  it("network error -> unreachable", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "unreachable" }),
    );
  });

  it("abort -> timeout", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async (_url: unknown, init: RequestInit | undefined) => {
      const controller = new AbortController();
      (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
        controller.abort();
      });
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    };
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "timeout" }),
    );
  });

  it("HTTP 404 -> http (unknown model)", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () => makeResponse({ detail: "Model not found" }, false, 404);
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "ghost_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "http" }),
    );
  });

  it("HTTP 500 -> http", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () => makeResponse({ detail: "boom" }, false, 500);
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "http" }),
    );
  });

  it("malformed JSON -> invalid_payload", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "invalid_payload" }),
    );
  });

  it("unexpected shape -> invalid_payload", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () => makeResponse({ success: true });
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "invalid_payload" }),
    );
  });

  it("valid payload returns detections", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () =>
      makeResponse({
        success: true,
        count: 1,
        detections: [
          { class_name: "person", confidence: 0.9, bbox: { x1: 1.2, y1: 2.7, x2: 3.4, y2: 4.8 } },
        ],
        output_path: "/tmp/out.jpg",
      });
    const okResult = await client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector");
    expect(okResult.count).toBe(1);
    expect(okResult.detections[0].bbox.x1).toBe(1);
  });

  it("confidence override forwarded as query param", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    let seenUrl: string | null = null;
    globalThis.fetch = async (input: unknown) => {
      seenUrl = String(input);
      return makeResponse({
        success: true,
        count: 0,
        detections: [],
        output_path: "/tmp/out.jpg",
      });
    };
    await client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector", 0.42);
    expect(seenUrl?.includes("confidence=0.42")).toBe(true);
  });

  it("confidence query param omitted by default", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    let seenUrl: string | null = null;
    globalThis.fetch = async (input: unknown) => {
      seenUrl = String(input);
      return makeResponse({
        success: true,
        count: 0,
        detections: [],
        output_path: "/tmp/out.jpg",
      });
    };
    await client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector");
    expect(seenUrl?.includes("confidence=")).toBe(false);
  });
});
