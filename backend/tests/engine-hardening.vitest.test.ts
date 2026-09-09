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
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
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

  it("HTTP 404 -> model_unavailable (unknown model)", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    globalThis.fetch = async () => makeResponse({ detail: "Model not found" }, false, 404);
    await expect(client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "ghost_detector")).rejects.toThrow(
      expect.objectContaining({ reason: "model_unavailable" }),
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
      headers: new Headers(),
      text: async () => {
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

  describe("retry behavior", () => {
    it("retries transient 503 then succeeds", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000, {
        maxRetries: 2,
        backoffBaseMs: 0,
      });
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) return makeResponse({ detail: "not ready" }, false, 503);
        return makeResponse({
          success: true,
          count: 0,
          detections: [],
          output_path: "/tmp/out.jpg",
        });
      };
      const result = await client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector");
      expect(calls).toBe(2);
      expect(result.success).toBe(true);
    });

    it("retries network unreachable then succeeds", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000, {
        maxRetries: 2,
        backoffBaseMs: 0,
      });
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("fetch failed");
        return makeResponse({
          success: true,
          count: 0,
          detections: [],
          output_path: "/tmp/out.jpg",
        });
      };
      const result = await client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector");
      expect(calls).toBe(2);
      expect(result.success).toBe(true);
    });

    it("gives up after exhausting retries", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000, {
        maxRetries: 2,
        backoffBaseMs: 0,
      });
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        throw new TypeError("fetch failed");
      };
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "unreachable" }));
      expect(calls).toBe(3);
    });

    it("does not retry 404 model unavailable", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000, {
        maxRetries: 3,
        backoffBaseMs: 0,
      });
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return makeResponse({ detail: "Model not found" }, false, 404);
      };
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "ghost"),
      ).rejects.toThrow(expect.objectContaining({ reason: "model_unavailable" }));
      expect(calls).toBe(1);
    });

    it("does not retry invalid payloads", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000, {
        maxRetries: 3,
        backoffBaseMs: 0,
      });
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        return makeResponse({ success: "yes" });
      };
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "invalid_payload" }));
      expect(calls).toBe(1);
    });

    it("retries capture frame on transient 5xx", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000, {
        maxRetries: 2,
        backoffBaseMs: 0,
      });
      let calls = 0;
      globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) return makeResponse({ detail: "busy" }, false, 503);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new ArrayBuffer(4),
        } as unknown as Response;
      };
      const buffer = await client.captureFrame("rtsp://example.test/live", "rtsp");
      expect(calls).toBe(2);
      expect(buffer.length).toBe(4);
    });
  });

  describe("response validation", () => {
    it("rejects detection without class_name", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      globalThis.fetch = async () =>
        makeResponse({
          success: true,
          count: 1,
          detections: [{ confidence: 0.9, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } }],
          output_path: "/tmp/out.jpg",
        });
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "invalid_payload" }));
    });

    it("rejects detection with non-finite confidence", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      globalThis.fetch = async () =>
        makeResponse({
          success: true,
          count: 1,
          detections: [{ class_name: "person", confidence: NaN, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } }],
          output_path: "/tmp/out.jpg",
        });
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "invalid_payload" }));
    });

    it("rejects confidence out of range", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      globalThis.fetch = async () =>
        makeResponse({
          success: true,
          count: 1,
          detections: [{ class_name: "person", confidence: 1.5, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } }],
          output_path: "/tmp/out.jpg",
        });
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "invalid_payload" }));
    });

    it("rejects detection with malformed bbox", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      globalThis.fetch = async () =>
        makeResponse({
          success: true,
          count: 1,
          detections: [{ class_name: "person", confidence: 0.8, bbox: "bad" }],
          output_path: "/tmp/out.jpg",
        });
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "invalid_payload" }));
    });

    it("rejects count that does not match detections length", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      globalThis.fetch = async () =>
        makeResponse({
          success: true,
          count: 5,
          detections: [
            { class_name: "person", confidence: 0.8, bbox: { x1: 0, y1: 0, x2: 1, y2: 1 } },
          ],
          output_path: "/tmp/out.jpg",
        });
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(expect.objectContaining({ reason: "invalid_payload" }));
    });

    it("rejects oversized response bodies", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      const bigPayload = JSON.stringify({
        success: true,
        count: 0,
        detections: [],
        output_path: "/tmp/out.jpg",
        padding: "x".repeat(6 * 1024 * 1024),
      });
      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => bigPayload,
        }) as unknown as Response;
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(
        expect.objectContaining({ reason: "invalid_payload" }),
      );
    });

    it("rejects response hinting oversize via content-length header", async () => {
      const client = new HttpAiServiceClient("http://ai.test", 5000);
      globalThis.fetch = async () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers({ "content-length": String(6 * 1024 * 1024) }),
          text: async () => JSON.stringify({ success: true, count: 0, detections: [], output_path: "" }),
        }) as unknown as Response;
      await expect(
        client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
      ).rejects.toThrow(
        expect.objectContaining({ reason: "invalid_payload" }),
      );
    });
  });
});
