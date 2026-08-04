import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT = 4400 + (process.pid % 300);
const BASE_URL = `http://localhost:${TEST_PORT}/api`;

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
  if (!(await isPortFree(TEST_PORT))) {
    console.error(`Port ${TEST_PORT} is not free`);
    process.exit(1);
  }

  const serverEntry = path.resolve(__dirname, "..", "src", "index.ts");
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
    console.error("Backend failed to start");
    process.exit(1);
  }
  ok("backend started and /health responds");

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (adminLogin.status !== 200 || !(adminLogin.body as { data?: { token?: string } }).data?.token) {
    fail("admin login returns token", adminLogin.body);
    return finalize();
  }
  ok("admin login returns token");
  const adminToken = (adminLogin.body as { data: { token: string } }).data.token;

  const viewerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "viewer@vigilens.io", password: "admin123" }),
  });
  const viewerToken = (viewerLogin.body as { data: { token: string } }).data?.token;
  if (!viewerToken) {
    fail("viewer login returns token", viewerLogin.body);
    return finalize();
  }
  ok("viewer login returns token");

  await sleep(300);

  const list = await request("/audit-logs", {}, adminToken);
  if (list.status !== 200 || !(list.body as { data?: unknown[] }).data?.length) {
    fail("GET /audit-logs returns paginated logs", list.body);
    return finalize();
  }
  ok("GET /audit-logs returns paginated logs");

  const listBody = list.body as {
    data: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  if (
    !listBody.data.every((log) =>
      ["id", "timestamp", "userId", "username", "email", "action", "module", "description", "ipAddress", "userAgent", "status"].every((key) => key in log),
    )
  ) {
    fail("audit log rows include all expected fields", listBody.data[0]);
    return finalize();
  }
  ok("audit log rows include all expected fields");

  const firstId = listBody.data[0].id as string;

  const loginLog = listBody.data.find((log) => log.action === "user_login");
  if (!loginLog) {
    fail("login actions are recorded in audit logs", listBody.data);
    return finalize();
  }
  ok("login actions are recorded in audit logs");

  const byId = await request(`/audit-logs/${firstId}`, {}, adminToken);
  if (byId.status !== 200 || (byId.body as { data?: { id?: string } }).data?.id !== firstId) {
    fail("GET /audit-logs/:id returns the log", byId.body);
    return finalize();
  }
  ok("GET /audit-logs/:id returns the log");

  const filtered = await request("/audit-logs?action=user_login", {}, adminToken);
  const filteredBody = filtered.body as { data: Array<{ action: string }> };
  if (filtered.status !== 200 || !filteredBody.data?.every((log) => log.action === "user_login")) {
    fail("action filter works", filteredBody);
    return finalize();
  }
  ok("action filter works");

  const moduleFiltered = await request("/audit-logs?module=auth", {}, adminToken);
  const moduleBody = moduleFiltered.body as { data: Array<{ module: string }> };
  if (
    moduleFiltered.status !== 200 ||
    !moduleBody.data?.every((log) => log.module.toLowerCase().includes("auth"))
  ) {
    fail("module filter works", moduleBody);
    return finalize();
  }
  ok("module filter works");

  const searchFiltered = await request("/audit-logs?search=admin@vigilens.io", {}, adminToken);
  const searchBody = searchFiltered.body as { data: Array<{ email: string }> };
  if (
    searchFiltered.status !== 200 ||
    !searchBody.data?.every((log) => (log.email || "").toLowerCase().includes("admin@vigilens.io"))
  ) {
    fail("search filter works", searchBody);
    return finalize();
  }
  ok("search filter works");

  const statusFiltered = await request("/audit-logs?status=success", {}, adminToken);
  const statusBody = statusFiltered.body as { data: Array<{ status: string }> };
  if (statusFiltered.status !== 200 || !statusBody.data?.every((log) => log.status === "success")) {
    fail("status filter works", statusBody);
    return finalize();
  }
  ok("status filter works");

  const today = new Date().toISOString().slice(0, 10);
  const dateFiltered = await request(`/audit-logs?dateFrom=${today}&dateTo=${today}`, {}, adminToken);
  const dateBody = dateFiltered.body as { data: Array<{ timestamp: string }> };
  if (dateFiltered.status !== 200 || dateBody.data?.length === 0) {
    fail("date range filter works", dateBody);
    return finalize();
  }
  ok("date range filter works");

  const paginated = await request("/audit-logs?page=1&limit=2", {}, adminToken);
  const paginatedBody = paginated.body as { limit: number; page: number; totalPages: number };
  if (paginated.status !== 200 || paginatedBody.limit !== 2 || paginatedBody.page !== 1) {
    fail("pagination params applied", paginatedBody);
    return finalize();
  }
  ok("pagination params applied");

  const stats = await request("/audit-logs/stats", {}, adminToken);
  const statsBody = stats.body as { data: { totalLogs: number; todayLogs: number; failedLogs: number; activeUsers: number } };
  if (
    stats.status !== 200 ||
    typeof statsBody.data?.totalLogs !== "number" ||
    typeof statsBody.data?.todayLogs !== "number" ||
    typeof statsBody.data?.failedLogs !== "number" ||
    typeof statsBody.data?.activeUsers !== "number"
  ) {
    fail("GET /audit-logs/stats returns dashboard stats", statsBody);
    return finalize();
  }
  ok("GET /audit-logs/stats returns dashboard stats");

  const charts = await request("/audit-logs/charts", {}, adminToken);
  const chartsBody = charts.body as {
    data: {
      actionsPerDay: unknown[];
      moduleUsage: unknown[];
      statusDistribution: unknown[];
      topUsers: unknown[];
    };
  };
  if (
    charts.status !== 200 ||
    !Array.isArray(chartsBody.data?.actionsPerDay) ||
    !Array.isArray(chartsBody.data?.moduleUsage) ||
    !Array.isArray(chartsBody.data?.statusDistribution) ||
    !Array.isArray(chartsBody.data?.topUsers)
  ) {
    fail("GET /audit-logs/charts returns chart data", chartsBody);
    return finalize();
  }
  ok("GET /audit-logs/charts returns chart data");

  const csv = await fetch(`${BASE_URL}/audit-logs/export`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const csvText = await csv.text();
  if (!csvText.includes("ID") || !csvText.includes("Action")) {
    fail("CSV export returns CSV content", csvText);
    return finalize();
  }
  ok("CSV export returns CSV content");

  const denied = await request("/audit-logs", {}, viewerToken);
  if (denied.status !== 403) {
    fail("viewer is denied access to audit logs (403)", denied.status);
    return finalize();
  }
  ok("viewer is denied access to audit logs (403)");

  const unauthorized = await request("/audit-logs", {});
  if (unauthorized.status !== 401) {
    fail("audit log routes require authentication (401)", unauthorized.status);
    return finalize();
  }
  ok("audit log routes require authentication (401)");

  const csvDenied = await request("/audit-logs/export", {}, viewerToken);
  if (csvDenied.status !== 403) {
    fail("viewer is denied CSV export (403)", csvDenied.status);
    return finalize();
  }
  ok("viewer is denied CSV export (403)");

  const logout = await request(
    "/auth/logout",
    { method: "POST" },
    viewerToken,
  );
  if (logout.status !== 200) {
    fail("POST /auth/logout logs out the user", logout.body);
    return finalize();
  }
  ok("POST /auth/logout logs out the user");

  await sleep(300);
  const afterLogout = await request("/audit-logs?action=user_logout", {}, adminToken);
  const afterLogoutBody = afterLogout.body as { data: Array<{ action: string }> };
  if (afterLogout.status !== 200 || !afterLogoutBody.data?.some((log) => log.action === "user_logout")) {
    fail("logout action is recorded in audit logs", afterLogoutBody);
    return finalize();
  }
  ok("logout action is recorded in audit logs");

  finalize();
}

async function finalize() {
  if (server) {
    killProcessTree(server);
    server = null;
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

process.on("SIGINT", () => finalize());

run().catch((err) => {
  console.error(err);
  finalize();
});
