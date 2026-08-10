/**
 * Detector Engine v2 — Reliability hardening unit tests.
 *
 * Focused on the AI client's error classification: empty frames, network
 * failures, timeouts, HTTP errors and malformed payloads must each produce
 * a typed `AiServiceError` so the engine can classify and recover.
 * No network or database is touched — fetch is stubbed.
 */

import { HttpAiServiceClient, AiServiceError } from "../src/engine/aiClient";

let passed = 0;
let failed = 0;

function expectEqual(actual: unknown, expected: unknown, name: string) {
  if (actual === expected) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name} — expected "${expected}", got "${actual}"`);
  }
}

function expectErrorType(promise: Promise<unknown>, reason: string, name: string) {
  return promise.then(
    () => {
      failed += 1;
      console.error(`  FAIL  ${name} — expected AiServiceError(${reason}) but it resolved`);
    },
    (err: unknown) => {
      if (err instanceof AiServiceError && err.reason === reason) {
        passed += 1;
        console.log(`  PASS  ${name}`);
      } else {
        failed += 1;
        console.error(`  FAIL  ${name} — got ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

function makeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

async function run() {
  const client = new HttpAiServiceClient("http://ai.test", 5000);
  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const originalFetch = globalThis.fetch;

  // 1. Empty frames are rejected before any network call.
  await expectErrorType(
    Promise.resolve(client.detectImage(Buffer.alloc(0))),
    "invalid_frame",
    "empty frame -> invalid_frame",
  );

  // 2. Network failure -> unreachable.
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  await expectErrorType(
    Promise.resolve(client.detectImage(frame, "person_detector")),
    "unreachable",
    "network error -> unreachable",
  );

  // 3. Timeout (abort) -> timeout.
  globalThis.fetch = async (_url: unknown, init: RequestInit | undefined) => {
    const controller = new AbortController();
    (init?.signal as AbortSignal | undefined)?.addEventListener("abort", () => {
      controller.abort();
    });
    throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
  };
  await expectErrorType(
    Promise.resolve(client.detectImage(frame, "person_detector")),
    "timeout",
    "abort -> timeout",
  );

  // 4. HTTP 404 (unknown model) -> http with status 404.
  globalThis.fetch = async () => makeResponse({ detail: "Model not found" }, false, 404);
  await expectErrorType(
    Promise.resolve(client.detectImage(frame, "ghost_detector")),
    "http",
    "HTTP 404 -> http (unknown model)",
  );

  // 5. HTTP 500 -> http.
  globalThis.fetch = async () => makeResponse({ detail: "boom" }, false, 500);
  await expectErrorType(
    Promise.resolve(client.detectImage(frame, "person_detector")),
    "http",
    "HTTP 500 -> http",
  );

  // 6. Malformed JSON -> invalid_payload.
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError("Unexpected token");
    },
  } as unknown as Response);
  await expectErrorType(
    Promise.resolve(client.detectImage(frame, "person_detector")),
    "invalid_payload",
    "malformed JSON -> invalid_payload",
  );

  // 7. Wrong shape -> invalid_payload.
  globalThis.fetch = async () => makeResponse({ success: true });
  await expectErrorType(
    Promise.resolve(client.detectImage(frame, "person_detector")),
    "invalid_payload",
    "unexpected shape -> invalid_payload",
  );

  // 8. Valid payload still returns detections (regression guard).
  globalThis.fetch = async () =>
    makeResponse({
      success: true,
      count: 1,
      detections: [
        { class_name: "person", confidence: 0.9, bbox: { x1: 1.2, y1: 2.7, x2: 3.4, y2: 4.8 } },
      ],
      output_path: "/tmp/out.jpg",
    });
  const okResult = await client.detectImage(frame, "person_detector");
  expectEqual(okResult.count, 1, "valid payload returns detections");
  expectEqual(okResult.detections[0].bbox.x1, 1, "bbox coordinates are integer-rounded");

  globalThis.fetch = originalFetch;

  console.log(`\nEngine hardening unit tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
