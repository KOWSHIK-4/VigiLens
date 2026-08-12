import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 4399;
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

async function request(path: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
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

/**
 * Picks a free loopback port for this test process. The PID-derived default
 * can collide with ephemeral or system listeners (Windows keeps e.g. 5040
 * bound), so walk offsets until a candidate is actually free.
 */
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

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for engine live tests...`);
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

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (login.status !== 200 || !login.body || typeof login.body !== "object") {
    fail("admin login", login);
    return;
  }
  const token = (login.body as { data: { token: string } }).data.token;
  ok("admin login returns token");

  // Unauthenticated live detections are rejected.
  const unauth = await request("/engines/person/detections");
  if (unauth.status === 401) {
    ok("GET /engines/:key/detections requires auth (401)");
  } else {
    fail("GET /engines/:key/detections requires auth", unauth.status);
  }

  // Unknown detector key is a 404.
  const unknown = await request("/engines/not-a-real-detector/detections", {}, token);
  if (unknown.status === 404) {
    ok("GET /engines/:key/detections 404 for unknown key");
  } else {
    fail("GET /engines/:key/detections 404 for unknown key", unknown.status);
  }

  // A live detection ingested through the internal endpoint is visible.
  const ingest = await request("/detections/internal", {
    method: "POST",
    body: JSON.stringify({
      camera_id: "demo-camera-1",
      label: "person",
      confidence: 0.78,
      image_url: "/tmp/live_test.jpg",
      detector_key: "person",
      class_name: "person",
      track_id: "99",
      bounding_box: { x1: 1, y1: 2, x2: 3, y2: 4 },
      metadata: { source: "webcam", detector_type: "person_detector" },
    }),
  });
  if (ingest.status !== 201) {
    fail("POST /detections/internal ingests live detection", ingest);
    return;
  }
  ok("POST /detections/internal ingests a live detection");

  const feed = await request("/engines/person/detections?limit=10", {}, token);
  const feedBody = feed.body as {
    data?: {
      key: string;
      count: number;
      detections: Array<{
        id: string;
        className: string | null;
        boundingBox: Record<string, number> | null;
        trackId: string | null;
        detectorKey: string | null;
        timestamp: string;
      }>;
    };
  };
  const found = feedBody.data?.detections.some((d) => d.trackId === "99");
  if (feed.status === 200 && feedBody.data && feedBody.data.key === "person" && found) {
    ok("live detection appears in engine feed", `count=${feedBody.data.count}`);
  } else {
    fail("live detection appears in engine feed", {
      status: feed.status,
      data: feedBody.data,
    });
  }

  // Metrics endpoint shape for an engine that has run.
  const metrics = await request("/engines/person/metrics", {}, token);
  if (metrics.status === 200) {
    ok("GET /engines/:key/metrics returns metrics");
  } else {
    fail("GET /engines/:key/metrics", metrics.status);
  }

  console.log(`\nEngine live detection tests: ${passed} passed, ${failed} failed`);
  if (server) killProcessTree(server);
  process.exit(failed === 0 ? 0 : 1);
}

run();
