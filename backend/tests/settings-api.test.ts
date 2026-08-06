import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT = 4900 + (process.pid % 200);
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

const ALL_CATEGORIES = [
  "general",
  "security",
  "ai_detection",
  "notifications",
  "cameras",
  "storage",
  "email",
  "backup",
];

interface SettingsRow {
  key: string;
  category: string;
  label: string;
  type: string;
  value: string | number | boolean;
}

async function login(email: string): Promise<string> {
  const res = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "admin123" }),
  });
  if (res.status !== 200 || !res.body || typeof res.body !== "object") {
    throw new Error(`login failed for ${email}: ${JSON.stringify(res)}`);
  }
  return (res.body as { data: { token: string } }).data.token;
}

async function run() {
  if (!(await isPortFree(TEST_PORT))) {
    fail("test port reservation", `port ${TEST_PORT} already in use`);
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for settings API tests...`);
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

  const adminToken = await login("admin@vigilens.io");
  ok("admin login returns token");

  const all = await request("/settings", {}, adminToken);
  const allBody = all.body as { data: SettingsRow[] };
  if (all.status === 200 && Array.isArray(allBody.data)) {
    ok("GET /settings returns settings list");
  } else {
    fail("GET /settings", all);
    return;
  }

  const presentCategories = new Set(allBody.data.map((s) => s.category));
  const missingCategories = ALL_CATEGORIES.filter((c) => !presentCategories.has(c));
  if (missingCategories.length === 0) {
    ok("GET /settings covers all 8 categories");
  } else {
    fail("settings categories", { missingCategories });
  }

  const general = allBody.data.find((s) => s.key === "system_name");
  if (general && general.value === "VigiLens" && general.type === "string") {
    ok("default general settings seeded");
  } else {
    fail("default general settings", general);
  }

  const securityDefaults = allBody.data.find((s) => s.key === "session_timeout_minutes");
  if (securityDefaults && securityDefaults.value === 30) {
    ok("security settings seeded with defaults");
  } else {
    fail("security settings defaults", securityDefaults);
  }

  const byCategory = await request("/settings/security", {}, adminToken);
  const security = byCategory.body as { data: SettingsRow[] };
  if (byCategory.status === 200 && security.data.length >= 9) {
    ok("GET /settings/security returns security category");
  } else {
    fail("GET /settings/security", byCategory);
  }

  const updated = await request(
    "/settings/security",
    {
      method: "PATCH",
      body: JSON.stringify({ session_timeout_minutes: 45, max_login_attempts: 7 }),
    },
    adminToken,
  );
  const updatedRows = (updated.body as { data: SettingsRow[] }).data ?? [];
  const timeoutRow = updatedRows.find((s) => s.key === "session_timeout_minutes");
  const attemptsRow = updatedRows.find((s) => s.key === "max_login_attempts");
  if (updated.status === 200 && timeoutRow?.value === 45 && attemptsRow?.value === 7) {
    ok("PATCH /settings/security updates values");
  } else {
    fail("PATCH /settings/security", updated);
  }

  const badRange = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ session_timeout_minutes: 99999 }) },
    adminToken,
  );
  if (badRange.status === 400) {
    ok("PATCH settings rejects out-of-range value (400)");
  } else {
    fail("PATCH settings range validation", badRange);
  }

  const badType = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ password_require_complexity: "yes" }) },
    adminToken,
  );
  if (badType.status === 400) {
    ok("PATCH settings rejects wrong type (400)");
  } else {
    fail("PATCH settings type validation", badType);
  }

  const unknownKey = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ not_a_real_setting: 1 }) },
    adminToken,
  );
  if (unknownKey.status === 400) {
    ok("PATCH settings rejects unknown key (400)");
  } else {
    fail("PATCH settings unknown key", unknownKey);
  }

  const badCategory = await request(
    "/settings/bogus",
    { method: "PATCH", body: JSON.stringify({ system_name: "x" }) },
    adminToken,
  );
  if (badCategory.status === 400) {
    ok("PATCH /settings/:category rejects unknown category (400)");
  } else {
    fail("PATCH settings unknown category", badCategory);
  }

  const emptyBody = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({}) },
    adminToken,
  );
  if (emptyBody.status === 400) {
    ok("PATCH settings rejects empty body (400)");
  } else {
    fail("PATCH settings empty body", emptyBody);
  }

  const reset = await request("/settings/security/reset", { method: "POST" }, adminToken);
  const resetRows = (reset.body as { data: SettingsRow[] }).data ?? [];
  const resetTimeout = resetRows.find((s) => s.key === "session_timeout_minutes");
  if (reset.status === 200 && resetTimeout?.value === 30) {
    ok("POST /settings/security/reset restores defaults");
  } else {
    fail("POST /settings/security/reset", reset);
  }

  const noAuth = await request("/settings");
  if (noAuth.status === 401) {
    ok("settings routes require authentication (401)");
  } else {
    fail("auth guard", noAuth);
  }

  const viewerToken = await login("viewer@vigilens.io");
  const viewerRead = await request("/settings", {}, viewerToken);
  if (viewerRead.status === 403) {
    ok("settings routes reject non-admin roles (403)");
  } else {
    fail("role guard", viewerRead);
  }

  const auditCheck = await request("/audit-logs?module=settings&limit=20", {}, adminToken);
  const auditBody = auditCheck.body as { data: Array<{ action: string; description: string }> };
  if (
    auditCheck.status === 200 &&
    auditBody.data.some(
      (log) => log.action === "settings_changed" && log.description.includes("security"),
    )
  ) {
    ok("settings changes are written to the audit log");
  } else {
    fail("settings audit log", auditBody.data ?? []);
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
