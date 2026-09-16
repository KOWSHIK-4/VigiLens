import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const TEST_PORT_BASE = 5071;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

const prisma = new PrismaClient();
let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const createdUserEmails: string[] = [];

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

async function cleanupDb() {
  try {
    if (createdUserEmails.length > 0) {
      await prisma.user.deleteMany({ where: { email: { in: createdUserEmails } } });
    }
  } catch (err) {
    console.error("cleanup error:", (err as Error).message);
  }
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for auth policy tests...`);
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

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  const adminToken =
    adminLogin.status === 200
      ? (adminLogin.body as { data: { token: string } }).data.token
      : "";
  if (adminLogin.status === 200) {
    ok("admin login returns token");
  } else {
    fail("admin login", adminLogin);
    return;
  }

  // ---- Registration is closed by default (and test-enforced) ----
  const disableUpdate = await request(
    "/settings/security",
    {
      method: "PATCH",
      body: JSON.stringify({ allow_registration: false }),
    },
    adminToken,
  );
  if (disableUpdate.status === 200) {
    ok("allow_registration can be toggled to false");
  } else {
    fail("disable registration", disableUpdate);
    return;
  }

  const closedEmail = `policy_closed_${Date.now()}@vigilens.io`;
  const closedRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Closed Policy", email: closedEmail, password: "PolicyPass99!" }),
  });
  if (closedRegister.status === 403) {
    ok("register is rejected while allow_registration is off (403)");
  } else {
    fail("register while disabled", closedRegister);
  }

  // ---- Enforce security policies driven by stored settings ----
  const policyUpdate = await request(
    "/settings/security",
    {
      method: "PATCH",
      body: JSON.stringify({
        max_login_attempts: 2,
        lockout_duration_minutes: 1440,
        password_min_length: 10,
        password_require_complexity: true,
        jwt_expiration_hours: 1,
        jwt_require_https: true,
        allow_registration: true,
      }),
    },
    adminToken,
  );
  if (policyUpdate.status === 200) {
    ok("security settings accept the test policy values");
  } else {
    fail("settings update", policyUpdate);
    return;
  }

  const weakEmail = `policy_weak_${Date.now()}@vigilens.io`;
  const weakRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Policy Weak", email: weakEmail, password: "Short1A!" }),
  });
  if (weakRegister.status === 400) {
    createdUserEmails.push(weakEmail);
    ok("register rejects a password shorter than password_min_length (400)");
  } else {
    fail("register weak password", weakRegister);
  }

  const plainEmail = `policy_plain_${Date.now()}@vigilens.io`;
  const plainRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Policy Plain", email: plainEmail, password: "abcdefgh12345" }),
  });
  if (plainRegister.status === 400) {
    createdUserEmails.push(plainEmail);
    ok("register rejects a password missing complexity classes (400)");
  } else {
    fail("register non-complex password", plainRegister);
  }

  const userEmail = `policy_user_${Date.now()}@vigilens.io`;
  const userPassword = "PolicyPass99!";
  createdUserEmails.push(userEmail);
  const validRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Policy User", email: userEmail, password: userPassword }),
  });
  if (validRegister.status === 201) {
    ok("register accepts a compliant password (201)");
  } else {
    fail("register valid password", validRegister);
    return;
  }

  // ---- Settings-driven lockout threshold + auto-expiry ----
  const wrong1 = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: userEmail, password: "WrongPass99!" }),
  });
  if (wrong1.status === 401) {
    ok("failed login 1 of 2 returns 401");
  } else {
    fail("failed login 1", wrong1);
  }

  const wrong2 = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: userEmail, password: "WrongPass99!" }),
  });
  if (wrong2.status === 401) {
    ok("failed login 2 of 2 returns 401");
  } else {
    fail("failed login 2", wrong2);
  }

  const lockedCorrect = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  if (lockedCorrect.status === 403) {
    ok("correct password is rejected once max_login_attempts is exceeded");
  } else {
    fail("lockout after max attempt", lockedCorrect);
  }

  // Shrink the lockout window, then age the lock past it so the account
  // unlocks on the next attempt without admin intervention.
  await request(
    "/settings/security",
    {
      method: "PATCH",
      body: JSON.stringify({ lockout_duration_minutes: 1 }),
    },
    adminToken,
  );
  await prisma.user.updateMany({
    where: { email: userEmail },
    data: { lockedAt: new Date(Date.now() - 5 * 60_000) },
  });

  const autoUnlock = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  if (autoUnlock.status === 200 && (autoUnlock.body as { data: { token: string } }).data.token) {
    ok("expired lockout clears automatically and login succeeds");
  } else {
    fail("auto unlock", autoUnlock);
    return;
  }

  // ---- jwt_expiration_hours from settings controls token lifetime ----
  const decoded = jwt.decode((autoUnlock.body as { data: { token: string } }).data.token) as
    | JwtPayload
    | null;
  if (decoded && typeof decoded.exp === "number" && typeof decoded.iat === "number") {
    const ttlSeconds = decoded.exp - decoded.iat;
    if (Math.abs(ttlSeconds - 3600) <= 60) {
      ok("issued token lifetime matches jwt_expiration_hours");
    } else {
      fail("token ttl", { ttlSeconds });
    }
  } else {
    fail("token decode", decoded);
  }

  // ---- HTTPS enforcement (only when the flag is on) ----
  const cleartextLogin = await request(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ email: userEmail, password: userPassword }),
      headers: { "x-forwarded-proto": "http" } as Record<string, string>,
    },
  );
  if (
    cleartextLogin.status === 403 &&
    (cleartextLogin.body as { code?: string }).code === "HTTPS_REQUIRED"
  ) {
    ok("login over cleartext is rejected with HTTPS_REQUIRED when enabled");
  } else {
    fail("cleartext login block", cleartextLogin);
  }

  const noHeaderLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: userEmail, password: userPassword }),
  });
  if (noHeaderLogin.status === 200) {
    ok("direct (non-proxy) login still allowed without proxy headers");
  } else {
    fail("no-header login", noHeaderLogin);
  }

  // ---- Restore defaults so later suites in the chain are unaffected ----
  const resetSettings = await request(
    "/settings/security/reset",
    { method: "POST" },
    adminToken,
  );
  if (resetSettings.status === 200) {
    ok("security settings reset to defaults");
  } else {
    fail("settings reset", resetSettings);
  }

  console.log(`\nAuth policy tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().finally(() => {
  if (server) killProcessTree(server);
  cleanupDb().finally(() => prisma.$disconnect().catch(() => undefined));
});