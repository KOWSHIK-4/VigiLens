/**
 * Request correlation across the AI service boundary.
 *
 * The API assigns every request a server-side request id. Outbound calls to
 * the AI service must forward that id in an X-Request-Id header so inference
 * and capture activity can be traced back to the originating API request.
 * No network or database is touched — fetch is stubbed.
 */

import { describe, it, expect, afterEach } from "vitest";
import { HttpAiServiceClient } from "../src/engine/aiClient";
import { runWithRequestContext, getRequestId } from "../src/utils/requestContext";

function detectionResponse(): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ success: true, count: 0, detections: [], output_path: "/tmp/out.jpg" }),
    text: async () => JSON.stringify({ success: true, count: 0, detections: [], output_path: "/tmp/out.jpg" }),
  } as unknown as Response;
}

describe("request correlation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("request id is visible only inside the request context", () => {
    expect(getRequestId()).toBeUndefined();
    runWithRequestContext({ requestId: "req-123" }, () => {
      expect(getRequestId()).toBe("req-123");
    });
    expect(getRequestId()).toBeUndefined();
  });

  it("AI service calls forward X-Request-Id and the internal key inside a request", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    let seenHeaders: Headers | null = null;
    globalThis.fetch = async (_input: unknown, init: RequestInit | undefined) => {
      seenHeaders = init?.headers ? new Headers(init.headers as Record<string, string>) : null;
      return detectionResponse();
    };

    await runWithRequestContext({ requestId: "req-corr-7" }, () =>
      client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector"),
    );

    expect(seenHeaders?.get("x-request-id")).toBe("req-corr-7");
    expect(seenHeaders?.get("x-internal-key")).toBeTruthy();
  });

  it("AI service calls omit X-Request-Id outside a request", async () => {
    const client = new HttpAiServiceClient("http://ai.test", 5000);
    let seenHeaders: Headers | null = null;
    globalThis.fetch = async (_input: unknown, init: RequestInit | undefined) => {
      seenHeaders = init?.headers ? new Headers(init.headers as Record<string, string>) : null;
      return detectionResponse();
    };

    await client.detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "person_detector");

    expect(seenHeaders?.get("x-request-id")).toBeNull();
    expect(seenHeaders?.get("x-internal-key")).toBeTruthy();
  });
});