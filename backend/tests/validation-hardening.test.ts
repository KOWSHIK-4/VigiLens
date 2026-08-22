import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 4941;
const TEST_PORT_RANGE = 500;
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

async function request(pathname: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${pathname}`, { ...options, headers });
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

async function expectStatus(
  name: string,
  expected: number,
  pathname: string,
  token: string,
  options: RequestInit = {},
) {
  const res = await request(pathname, options, token);
  if (res.status === expected) ok(name);
  else fail(name, { expected, got: res.status, body: res.body });
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for validation hardening tests...`);
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

  // --- Malformed request bodies are client errors ---
  await expectStatus(
    "malformed JSON body returns 400 instead of 500",
    400,
    "/auth/login",
    token,
    { method: "POST", body: '{"email": broken' },
  );

  // --- Analytics query validation ---
  await expectStatus("analytics period=bogus is rejected", 400, "/analytics/daily?period=bogus", token);
  await expectStatus("analytics from=not-a-date is rejected", 400, "/analytics/cameras?from=not-a-date", token);
  await expectStatus("analytics to=12/45/9999 is rejected", 400, "/analytics/timeline?to=12/45/9999", token);
  await expectStatus("analytics confidence accepts a valid period", 200, "/analytics/confidence?period=30", token);
  await expectStatus("analytics daily accepts parseable dates", 200, "/analytics/daily?from=2026-01-01&to=2026-01-31", token);

  // --- Detections ---
  await expectStatus("detections limit=5000 is rejected", 400, "/detections?limit=5000", token);
  await expectStatus("detections sortBy=sneaky is rejected", 400, "/detections?sortBy=(select)", token);
  await expectStatus("detections dateFrom=garbage is rejected", 400, "/detections?dateFrom=garbage", token);
  await expectStatus("detections export rejects bad filters", 400, "/detections/export/csv?status=nope", token);
  await expectStatus("detections :id must be a uuid", 400, "/detections/not-a-uuid", token);
  await expectStatus(
    "deleting an unknown detection uuid returns 404",
    404,
    "/detections/00000000-0000-4000-8000-000000000000",
    token,
    { method: "DELETE" },
  );
  await expectStatus("detections list accepts a valid query", 200, "/detections?page=1&limit=5&sortBy=confidence&sortOrder=asc", token);

  // --- Cameras ---
  await expectStatus("camera :id must be a uuid", 400, "/cameras/not-a-uuid", token);
  await expectStatus("camera health probe validates :id", 400, "/cameras/xyz/health", token, { method: "POST" });

  // --- Audit logs ---
  await expectStatus("audit export rejects a bad dateFrom", 400, "/audit-logs/export?dateFrom=zzz", token);
  await expectStatus("audit export accepts valid filters", 200, "/audit-logs/export?action=user_login", token);
  await expectStatus("audit log :id must be a uuid", 400, "/audit-logs/nope", token);

  // --- Reports ---
  await expectStatus("report :id must be a uuid", 400, "/reports/oops", token);
  await expectStatus("report download format is restricted", 400, "/reports/download/00000000-0000-4000-8000-000000000000?format=exe", token);

  // --- Engines ---
  await expectStatus("engine key must be a slug", 400, "/engines/BAD%20KEY!/health", token);
  await expectStatus("engine accepts a well-formed key", 404, "/engines/person_detection/health", token);

  console.log(`\nValidation hardening tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().finally(() => {
  if (server) killProcessTree(server);
});
