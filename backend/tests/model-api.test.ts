import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 4321;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;
const TEST_DETECTOR_KEY = `test_${Date.now()}`;

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

  console.log(`Starting backend server on port ${TEST_PORT} for API tests...`);
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

  const list = await request("/models?page=1&limit=100", {}, token);
  if (list.status !== 200) {
    fail("GET /models", list);
    return;
  }
  const listBody = list.body as { total: number; data: unknown[] };
  if (listBody.total < 8) {
    fail("GET /models seeded count", listBody);
  } else {
    ok(`GET /models returns seeded models (total=${listBody.total})`);
  }

  const active = await request("/models/active", {}, token);
  if (active.status !== 200) {
    fail("GET /models/active", active);
  } else {
    ok("GET /models/active returns a model");
  }

  const created = await request(
    "/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Test Detection",
        version: "9.9.9",
        detectorKey: TEST_DETECTOR_KEY,
        description: "Temporary integration test model",
        confidenceThreshold: 42,
        enabled: true,
        gpuSupported: true,
        modelPath: "/models/test/test.pt",
      }),
    },
    token,
  );
  if (created.status !== 201) {
    fail("POST /models create", created);
    return;
  }
  const createdBody = created.body as { data: { id: string; detectorKey: string } };
  const modelId = createdBody.data.id;
  if (createdBody.data.detectorKey !== TEST_DETECTOR_KEY) {
    fail("POST /models payload", createdBody);
  } else {
    ok("POST /models creates a model");
  }

  const dup = await request(
    "/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Duplicate",
        version: "1.0.0",
        detectorKey: TEST_DETECTOR_KEY,
      }),
    },
    token,
  );
  if (dup.status === 409) {
    ok("POST /models rejects duplicate detector key (409)");
  } else {
    fail("POST /models duplicate guard", dup);
  }

  const invalid = await request(
    "/models",
    {
      method: "POST",
      body: JSON.stringify({ name: "", version: "", detectorKey: "" }),
    },
    token,
  );
  if (invalid.status === 400) {
    ok("POST /models validates input (400)");
  } else {
    fail("POST /models validation", invalid);
  }

  const threshold = await request(
    `/models/${modelId}/threshold`,
    {
      method: "PATCH",
      body: JSON.stringify({ confidenceThreshold: 77 }),
    },
    token,
  );
  if (
    threshold.status === 200 &&
    (threshold.body as { data: { confidenceThreshold: number } }).data
      .confidenceThreshold === 77
  ) {
    ok("PATCH /models/:id/threshold updates threshold to 77");
  } else {
    fail("PATCH /models/:id/threshold", threshold);
  }

  const badThreshold = await request(
    `/models/${modelId}/threshold`,
    { method: "PATCH", body: JSON.stringify({ confidenceThreshold: 150 }) },
    token,
  );
  if (badThreshold.status === 400) {
    ok("PATCH threshold rejects out-of-range value (400)");
  } else {
    fail("PATCH threshold range validation", badThreshold);
  }

  const disabled = await request(
    `/models/${modelId}/disable`,
    { method: "PATCH" },
    token,
  );
  if (
    disabled.status === 200 &&
    (disabled.body as { data: { enabled: boolean } }).data.enabled === false
  ) {
    ok("PATCH /models/:id/disable disables the model");
  } else {
    fail("PATCH /models/:id/disable", disabled);
  }

  const loadBlocked = await request(
    `/models/${modelId}/load`,
    { method: "POST" },
    token,
  );
  if (loadBlocked.status === 400) {
    ok("POST /models/:id/load blocks disabled models (400)");
  } else {
    fail("POST load disabled guard", loadBlocked);
  }

  const enabled = await request(
    `/models/${modelId}/enable`,
    { method: "PATCH" },
    token,
  );
  if (
    enabled.status === 200 &&
    (enabled.body as { data: { enabled: boolean } }).data.enabled === true
  ) {
    ok("PATCH /models/:id/enable enables the model");
  } else {
    fail("PATCH /models/:id/enable", enabled);
  }

  const updated = await request(
    `/models/${modelId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: "Test Detection v2", gpuSupported: false }),
    },
    token,
  );
  if (
    updated.status === 200 &&
    (updated.body as { data: { name: string } }).data.name === "Test Detection v2"
  ) {
    ok("PATCH /models/:id updates model fields");
  } else {
    fail("PATCH /models/:id", updated);
  }

  const search = await request(
    `/models?search=v2&enabled=true`,
    {},
    token,
  );
  if (
    search.status === 200 &&
    (search.body as { total: number }).total === 1
  ) {
    ok("GET /models filters by search + enabled");
  } else {
    fail("GET /models search filter", search);
  }

  const loaded = await request(`/models/${modelId}/load`, { method: "POST" }, token);
  if (
    loaded.status === 200 &&
    (loaded.body as { data: { status: string } }).data.status === "loading"
  ) {
    ok("POST /models/:id/load sets status to loading");
  } else {
    fail("POST /models/:id/load", loaded);
  }

  await sleep(1500);
  const afterLoad = await request(`/models/${modelId}`, {}, token);
  if (
    afterLoad.status === 200 &&
    (afterLoad.body as { data: { status: string } }).data.status === "loaded"
  ) {
    ok("model reaches loaded status after load delay");
  } else {
    fail("model load finalization", afterLoad);
  }

  const testResult = await request(`/models/${modelId}/test`, { method: "POST" }, token);
  if (
    testResult.status === 200 &&
    (testResult.body as { data: { success: boolean } }).data.success === true
  ) {
    ok("POST /models/:id/test runs on loaded model");
  } else {
    fail("POST /models/:id/test", testResult);
  }

  const unloaded = await request(`/models/${modelId}/unload`, { method: "POST" }, token);
  if (
    unloaded.status === 200 &&
    (unloaded.body as { data: { status: string } }).data.status === "disabled"
  ) {
    ok("POST /models/:id/unload resets status to disabled");
  } else {
    fail("POST /models/:id/unload", unloaded);
  }

  const removed = await request(`/models/${modelId}`, { method: "DELETE" }, token);
  if (removed.status === 200) {
    ok("DELETE /models/:id removes the model");
  } else {
    fail("DELETE /models/:id", removed);
  }

  const missing = await request(`/models/${modelId}`, {}, token);
  if (missing.status === 404) {
    ok("GET /models/:id returns 404 after delete");
  } else {
    fail("GET deleted model", missing);
  }

  const badId = await request("/models/not-a-uuid", {}, token);
  if (badId.status === 400) {
    ok("model routes validate uuid params (400)");
  } else {
    fail("uuid param validation", badId);
  }

  const noAuth = await request("/models");
  if (noAuth.status === 401) {
    ok("model routes require authentication (401)");
  } else {
    fail("auth guard", noAuth);
  }
}

async function main() {
  try {
    await run();
  } catch (err) {
    failed += 1;
    console.error("Unexpected test error:", err);
  } finally {
    if (server) {
      killProcessTree(server);
      await sleep(1500);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

void main();
