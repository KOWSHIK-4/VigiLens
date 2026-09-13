import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 5521;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}`;

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
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
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
  return { status: res.status, headers: res.headers, body };
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for observability tests...`);
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
  ok("backend started");

  // Unauthenticated access to log tailing is rejected.
  const unauth = await request("/api/system/logs");
  if (unauth.status === 401) {
    ok("GET /api/system/logs requires authentication (401)");
  } else {
    fail("unauth logs", unauth);
  }

  async function login(email: string, password = "admin123") {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res as unknown as { status: number; body: { data: { token: string } } };
  }

  const superLogin = await login("super@vigilens.io");
  if (superLogin.status !== 200) {
    fail("super login", superLogin);
    return;
  }
  const token = superLogin.body.data.token;

  // The buffer already holds entries from the requests made on this server
  // (liveness checks, the 401 above, the login) — every HTTP call is logged.
  const logs = await request("/api/system/logs", {}, token);
  const entries = logs.body as { data: Array<Record<string, unknown>> } | null;
  if (
    logs.status === 200 &&
    Array.isArray(entries?.data) &&
    entries.data.length > 0 &&
    entries.data.every((entry) => typeof entry.level === "string" && typeof entry.message === "string")
  ) {
    ok("GET /api/system/logs returns log entries with level and message");
  } else {
    fail("logs endpoint", logs);
  }

  const limited = await request("/api/system/logs?limit=1", {}, token);
  const limitedData = limited.body as { data: unknown[] } | null;
  if (limited.status === 200 && Array.isArray(limitedData?.data) && limitedData.data.length === 1) {
    ok("GET /api/system/logs?limit=1 caps the returned entries");
  } else {
    fail("limited logs", limited);
  }

  // Request metrics break down by status code (the 401 above) and endpoint.
  const metrics = await request("/api/system/metrics", {}, token);
  const met = metrics.body as {
    data?: {
      requests?: {
        total?: number;
        statusCodes?: Record<string, number>;
        topEndpoints?: Array<{ endpoint: string; count: number }>;
      };
      operations?: { counters?: Record<string, number>; gauges?: Record<string, number> };
    };
  };
  if (
    metrics.status === 200 &&
    typeof met?.data?.requests?.total === "number" &&
    met.data.requests.total > 0 &&
    typeof met.data.requests.statusCodes === "object" &&
    (met.data.requests.statusCodes["401"] ?? 0) > 0 &&
    Array.isArray(met.data.requests.topEndpoints) &&
    met.data.requests.topEndpoints.length > 0
  ) {
    ok("GET /api/system/metrics reports status-code and endpoint breakdown");
  } else {
    fail("metrics breakdown", metrics);
  }

  if (
    metrics.status === 200 &&
    typeof met?.data?.operations?.counters === "object" &&
    typeof met?.data?.operations?.gauges === "object"
  ) {
    ok("GET /api/system/metrics exposes operational counters and gauges");
  } else {
    fail("metrics operations", metrics);
  }

  const operatorLogin = await login("operator@vigilens.io");
  if (operatorLogin.status !== 200) {
    fail("operator login", operatorLogin);
    return;
  }
  const operatorToken = operatorLogin.body.data.token;

  const denied = await request("/api/system/logs", {}, operatorToken);
  if (denied.status === 403) {
    ok("operator without monitoring.read is denied log access (403)");
  } else {
    fail("operator RBAC denial for logs", denied);
  }
}

run()
  .then(() => {
    if (server) killProcessTree(server);
    console.log(`\nObservability tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    if (server) killProcessTree(server);
    console.error(err);
    process.exit(1);
  });