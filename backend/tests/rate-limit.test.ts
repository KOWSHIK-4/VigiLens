import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 4971;
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

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for rate limit tests...`);
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

  // --- Global limiter: sustained UI polling must stay under the cap ---
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

  let pollingBlocked = false;
  for (let i = 0; i < 150; i++) {
    const res = await request("/auth/me", {}, token);
    if (res.status === 429) {
      pollingBlocked = true;
      break;
    }
  }
  if (!pollingBlocked) {
    ok("150 rapid dashboard-style requests stay under the global cap");
  } else {
    fail("global rate limit", "normal UI polling volume was throttled with 429");
  }

  // --- Auth limiter: 20 attempts per 15 minutes on credential endpoints ---
  let saw429 = false;
  for (let i = 0; i < 25; i++) {
    const res = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@vigilens.io", password: `wrong-${i}` }),
    });
    if (res.status === 429) {
      saw429 = true;
      break;
    }
  }
  if (saw429) {
    ok("login attempts beyond the auth bucket are rejected with 429");
  } else {
    fail("auth rate limit", "25 failed logins never produced a 429");
  }

  // The failed attempts above trip the per-account lockout, which persists
  // in the database and would break later suites in the chain. Reset it.
  await prisma.user.updateMany({
    where: { email: "admin@vigilens.io" },
    data: { isLocked: false, failedLoginAttempts: 0, lockedAt: null },
  });

  console.log(`\nRate limit tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().finally(() => {
  if (server) killProcessTree(server);
  prisma.$disconnect().catch(() => undefined);
});
