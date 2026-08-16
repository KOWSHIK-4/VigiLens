/**
 * Internal detection ingestion security tests.
 *
 * `POST /api/detections/internal` is the machine-to-machine ingestion
 * endpoint used by the AI service (live webcam stream). It must not be
 * reachable anonymously or with only a browser session — a shared internal
 * API key (`X-Internal-Key`) is required. This test verifies:
 *
 *   - no key            -> 401
 *   - wrong key         -> 401
 *   - valid key + body  -> 201 (detection persisted against a real camera)
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 4730;
const TEST_PORT_RANGE = 300;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${JSON.stringify(detail)}`);
}

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port, "127.0.0.1");
  });
}

async function resolveTestPort(base: number, range: number): Promise<number> {
  for (let offset = 0; offset < 100; offset++) {
    const candidate = base + ((process.pid + offset) % range);
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`no free test port in ${base}-${base + range}`);
}

function killProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      child.kill("SIGKILL");
    }
  } else {
    child.kill("SIGTERM");
  }
}

async function waitForServer(timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

const VALID_BODY = {
  camera_id: "demo-camera-1",
  label: "person",
  confidence: 0.8,
  image_url: "/tmp/internal_test.jpg",
  detector_key: "person",
  class_name: "person",
  track_id: "101",
  bounding_box: { x1: 1, y1: 2, x2: 3, y2: 4 },
  metadata: { source: "webcam", detector_type: "person_detector" },
};

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for internal API tests...`);
  server = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test" },
    },
  );

  if (!(await waitForServer())) {
    fail("server startup", `backend did not become healthy on port ${TEST_PORT}`);
    return;
  }
  ok("backend started and /health responds");

  const wrongKey = "definitely-not-the-key";
  const validKey = process.env.INTERNAL_API_KEY || "dev-internal-key-change-in-production";

  // No internal key -> rejected.
  const noKey = await request("/detections/internal", {
    method: "POST",
    body: JSON.stringify(VALID_BODY),
  });
  if (noKey.status === 401) {
    ok("POST /detections/internal without key returns 401");
  } else {
    fail("POST /detections/internal without key returns 401", noKey.status);
  }

  // Wrong internal key -> rejected.
  const badKey = await request("/detections/internal", {
    method: "POST",
    headers: { "X-Internal-Key": wrongKey },
    body: JSON.stringify(VALID_BODY),
  });
  if (badKey.status === 401) {
    ok("POST /detections/internal with wrong key returns 401");
  } else {
    fail("POST /detections/internal with wrong key returns 401", badKey.status);
  }

  // A bearer token (valid user session) does NOT bypass the internal key.
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  const token =
    login.status === 200 && login.body
      ? (login.body as { data: { token: string } }).data.token
      : "";
  const sessionOnly = await request("/detections/internal", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(VALID_BODY),
  });
  if (sessionOnly.status === 401) {
    ok("a user session alone cannot ingest detections (401)");
  } else {
    fail("a user session alone cannot ingest detections", sessionOnly.status);
  }

  // Valid internal key -> detection persisted.
  const accepted = await request("/detections/internal", {
    method: "POST",
    headers: { "X-Internal-Key": validKey },
    body: JSON.stringify(VALID_BODY),
  });
  if (accepted.status === 201) {
    ok("POST /detections/internal with valid key persists a detection");
  } else {
    fail("POST /detections/internal with valid key persists a detection", accepted);
  }

  console.log(`\nInternal API security tests: ${passed} passed, ${failed} failed`);
  if (server) killProcessTree(server);
  process.exit(failed === 0 ? 0 : 1);
}

run();
