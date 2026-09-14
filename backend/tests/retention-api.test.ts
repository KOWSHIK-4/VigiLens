import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 5641;
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

  console.log(`Starting backend server on port ${TEST_PORT} for retention API tests...`);
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

  const unauth = await request("/api/system/monitoring");
  if (unauth.status === 401) {
    ok("GET /api/system/monitoring requires authentication (401)");
  } else {
    fail("unauth monitoring", unauth);
  }

  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "super@vigilens.io", password: "admin123" }),
  });
  const loginBody = login.body as { data?: { token?: string } } | null;
  if (login.status !== 200 || !loginBody?.data?.token) {
    fail("super login", login);
    return;
  }
  const token = loginBody.data.token;

  const monitoring = await request("/api/system/monitoring", {}, token);
  const mon = monitoring.body as {
    data?: {
      retention?: {
        running?: boolean;
        autoCleanupEnabled?: boolean;
        intervalDays?: number;
        runCount?: number;
        lastRunAt?: string | null;
      };
    };
  } | null;
  if (monitoring.status === 200 && mon?.data?.retention) {
    const r = mon.data.retention;
    if (r.running === true) {
      ok("monitoring reports retention scheduler running (auto-started)");
    } else {
      fail("retention.running", r);
    }
    if (r.autoCleanupEnabled === true) {
      ok("monitoring reads auto_cleanup_enabled from settings");
    } else {
      fail("retention.autoCleanupEnabled", r);
    }
    if (typeof r.intervalDays === "number" && r.intervalDays >= 1) {
      ok("monitoring reads cleanup_interval_days from settings");
    } else {
      fail("retention.intervalDays", r);
    }
    if (typeof r.runCount === "number" && r.runCount === 0 && r.lastRunAt === null) {
      ok("retention scheduler is idle (no prune before first interval)");
    } else {
      fail("retention idle state", r);
    }
  } else {
    fail("GET /api/system/monitoring", monitoring);
  }

  const storage = await request("/api/settings/storage", {}, token);
  const stBody = storage.body as {
    data?: Array<{ key?: string; value?: unknown; defaultValue?: unknown }>;
  } | null;
  const items = Array.isArray(stBody?.data) ? stBody.data : [];
  const reportSetting = items.find((s) => s.key === "report_retention_days");
  if (storage.status === 200 && reportSetting && reportSetting.value === 90) {
    ok("GET /api/settings/storage exposes report_retention_days default 90");
  } else {
    fail("report_retention_days setting", stBody);
  }

  const auditByAction = await request("/api/audit-logs?action=retention_pruned", {}, token);
  if (auditByAction.status === 200) {
    ok("audit log query schema accepts action=retention_pruned");
  } else {
    fail("audit-logs retention_pruned filter", auditByAction);
  }
}

run()
  .then(() => {
    if (server) killProcessTree(server);
    console.log(`\nRetention API tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    if (server) killProcessTree(server);
    console.error(err);
    process.exit(1);
  });