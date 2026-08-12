import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 5121;
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

  console.log(`Starting backend server on port ${TEST_PORT} for system monitoring tests...`);
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

  // Health endpoints
  const health = await request("/health");
  const hb = health.body as { status?: string; service?: string; version?: string };
  if (health.status === 200 && hb.status === "ok" && hb.service === "vigilens-api" && hb.version) {
    ok("GET /health returns liveness report");
  } else {
    fail("GET /health", health);
  }

  const live = await request("/health/live");
  const lb = live.body as { status?: string; service?: string };
  if (live.status === 200 && lb.status === "ok" && lb.service === "vigilens-api") {
    ok("GET /health/live returns ok");
  } else {
    fail("GET /health/live", live);
  }

  const ready = await request("/health/ready");
  const readyBody = ready.body as { data?: Record<string, unknown> };
  const report = (readyBody.data ?? readyBody) as {
    status?: string;
    services?: Array<Record<string, unknown>>;
  };
  const services = report.services ?? [];
  const hasAllServices = ["postgres", "prisma", "ai", "storage", "redis"].every((name) =>
    services.some((s) => s.name === name),
  );
  const hasStatusFields = services.every(
    (s) =>
      typeof s.status === "string" &&
      typeof s.responseTimeMs === "number" &&
      typeof s.lastChecked === "string",
  );
  if (
    (ready.status === 200 || ready.status === 503) &&
    typeof report.status === "string" &&
    hasAllServices &&
    hasStatusFields
  ) {
    ok(`GET /health/ready returns ${ready.status} with all service checks`);
  } else {
    fail("GET /health/ready", { status: ready.status, body: readyBody });
  }

  // Consistent error format + request ID on unknown route
  const notFound = await request("/api/definitely-not-a-route");
  const nf = notFound.body as Record<string, unknown>;
  if (
    notFound.status === 404 &&
    nf.success === false &&
    typeof nf.requestId === "string" &&
    typeof nf.endpoint === "string" &&
    typeof nf.method === "string" &&
    typeof nf.timestamp === "string" &&
    notFound.headers.get("x-request-id")
  ) {
    ok("unknown route returns standardized 404 body with requestId");
  } else {
    fail("unknown route 404", { status: notFound.status, body: nf });
  }

  // Monitoring requires auth
  const unauth = await request("/api/system/monitoring");
  if (unauth.status === 401) {
    ok("GET /api/system/monitoring requires authentication (401)");
  } else {
    fail("unauth monitoring", unauth);
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

  const monitoring = await request("/api/system/monitoring", {}, token);
  const mon = monitoring.body as { data: Record<string, unknown> } | null;
  if (
    monitoring.status === 200 &&
    typeof mon?.data?.status === "string" &&
    typeof mon?.data?.version === "string" &&
    Array.isArray(mon.data.services) &&
    (mon.data.resources as { cpu?: unknown })?.cpu &&
    (mon.data.resources as { memory?: unknown })?.memory &&
    (mon.data.resources as { disk?: unknown })?.disk
  ) {
    ok("GET /api/system/monitoring returns status, services and resources");
  } else {
    fail("GET /api/system/monitoring", monitoring);
  }

  const metrics = await request("/api/system/metrics", {}, token);
  const met = metrics.body as { data: { requests?: unknown; detections?: unknown } } | null;
  if (
    metrics.status === 200 &&
    typeof met?.data?.requests === "object" &&
    typeof met?.data?.detections === "object"
  ) {
    ok("GET /api/system/metrics returns request and detection metrics");
  } else {
    fail("GET /api/system/metrics", metrics);
  }

  const operatorLogin = await login("operator@vigilens.io");
  if (operatorLogin.status !== 200) {
    fail("operator login", operatorLogin);
    return;
  }
  const operatorToken = operatorLogin.body.data.token;

  const denied = await request("/api/system/monitoring", {}, operatorToken);
  if (denied.status === 403) {
    ok("operator without monitoring.read is denied (403)");
  } else {
    fail("operator RBAC denial", denied);
  }
}

run()
  .then(() => {
    if (server) killProcessTree(server);
    console.log(`\nSystem monitoring tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    if (server) killProcessTree(server);
    console.error(err);
    process.exit(1);
  });
