import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 5621;
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

  console.log(`Starting backend server on port ${TEST_PORT} for monitor API tests...`);
  server = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test", MONITOR_ENABLED: "false" },
    },
  );

  if (!(await waitForServer())) {
    fail("server startup", `backend did not become healthy on port ${TEST_PORT}`);
    return;
  }
  ok("backend started");

  async function login(email: string, password = "admin123") {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res as unknown as { status: number; body: { data: { token: string } } };
  }

  const unauth = await request("/api/monitor");
  if (unauth.status === 401) {
    ok("GET /api/monitor requires authentication (401)");
  } else {
    fail("unauth monitor", unauth);
  }

  const superLogin = await login("super@vigilens.io");
  if (superLogin.status !== 200) {
    fail("super login", superLogin);
    return;
  }
  const token = superLogin.body.data.token;

  const status = await request("/api/monitor", {}, token);
  const st = status.body as {
    data?: { running?: boolean; loopCount?: number; loops?: Array<Record<string, unknown>> };
  } | null;
  if (
    status.status === 200 &&
    st?.data?.running === false &&
    typeof st.data.loopCount === "number" &&
    Array.isArray(st.data.loops)
  ) {
    ok("GET /api/monitor returns stopped scheduler with loop list");
  } else {
    fail("GET /api/monitor", status);
  }

  const start = await request("/api/monitor/start", { method: "POST", body: "{}" }, token);
  const st2 = start.body as { data?: { running?: boolean } } | null;
  if (start.status === 200 && st2?.data?.running === true) {
    ok("POST /api/monitor/start turns the scheduler on");
  } else {
    fail("POST /api/monitor/start", start);
  }

  const startAgain = await request("/api/monitor/start", { method: "POST", body: "{}" }, token);
  const st3 = startAgain.body as { data?: { running?: boolean } } | null;
  if (startAgain.status === 200 && st3?.data?.running === true) {
    ok("POST /api/monitor/start is idempotent while running");
  } else {
    fail("idempotent start", startAgain);
  }

  const running = await request("/api/monitor", {}, token);
  const rt = running.body as {
    data?: { loops?: Array<{ detectorKey?: string; status?: string }> };
  } | null;
  if (running.status === 200 && rt?.data?.loops?.length && rt.data.loops.length >= 1) {
    ok("GET /api/monitor reports configured loops");
  } else {
    fail("running loops", running);
  }

  const stop = await request("/api/monitor/stop", { method: "POST", body: "{}" }, token);
  const st4 = stop.body as { data?: { running?: boolean } } | null;
  if (stop.status === 200 && st4?.data?.running === false) {
    ok("POST /api/monitor/stop turns the scheduler off");
  } else {
    fail("POST /api/monitor/stop", stop);
  }

  const operatorLogin = await login("operator@vigilens.io");
  if (operatorLogin.status !== 200) {
    fail("operator login", operatorLogin);
    return;
  }
  const operatorToken = operatorLogin.body.data.token;

  const denied = await request("/api/monitor/start", { method: "POST", body: "{}" }, operatorToken);
  if (denied.status === 403) {
    ok("operator without monitoring.manage is denied start (403)");
  } else {
    fail("operator RBAC denial", denied);
  }
}

run()
  .then(() => {
    if (server) killProcessTree(server);
    console.log(`\nMonitor API tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    if (server) killProcessTree(server);
    console.error(err);
    process.exit(1);
  });
