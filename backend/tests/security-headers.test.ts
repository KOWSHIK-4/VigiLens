import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import jwt from "jsonwebtoken";

const TEST_PORT_BASE = 6501;
const TEST_PORT_RANGE = 400;

let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;

function ok(name: string, detail?: unknown) {
  passed += 1;
  console.log(`  PASS  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

function fail(name: string, detail?: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`);
}

async function request(
  pathname: string,
  options: RequestInit = {},
  token?: string,
): Promise<{ status: number; headers: Headers; body: unknown }> {
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

async function rawFetch(pathname: string, options: RequestInit = {}) {
  const res = await fetch(`http://localhost:${TEST_PORT}${pathname}`, options);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, headers: res.headers, body };
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

function spawnServer(extraEnv: Record<string, string> = {}) {
  return spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test", ...extraEnv },
    },
  );
}

const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for security header tests...`);
  // Pass an explicit allowlist (rather than inheriting backend/.env) so the
  // header/CORS assertions are deterministic.
  server = spawnServer({
    CORS_ORIGIN: "https://viglens-rho.vercel.app,http://localhost:5173",
  });
  if (!(await waitForServer())) {
    fail("server startup", `backend did not become healthy on port ${TEST_PORT}`);
    return;
  }
  ok("backend started and /health responds");

  // 1) Security headers are present on API responses.
  const me = await rawFetch("/api/auth/me");
  if (me.status === 401) {
    ok("GET /api/auth/me requires auth (401 baseline)");
  } else {
    fail("GET /api/auth/me requires auth", me.status);
  }

  const h = me.headers;
  const checks: Array<[string, string, (v: string) => boolean]> = [
    ["x-content-type-options", "nosniff", (v) => v === "nosniff"],
    ["x-frame-options", "DENY", (v) => v === "DENY"],
    ["referrer-policy", "no-referrer", (v) => v === "no-referrer"],
    [
      "content-security-policy",
      "default-src 'none'",
      (v) => v.toLowerCase().includes("default-src 'none'"),
    ],
    [
      "permissions-policy",
      "geolocation blocked",
      (v) => v.includes("geolocation=()") && v.includes("microphone=()"),
    ],
  ];
  for (const [name, label, predicate] of checks) {
    const value = h.get(name);
    if (value !== null && predicate(value)) ok(`${name} header is set (${label})`);
    else fail(`${name} header`, value);
  }

  if (h.get("x-powered-by") === null) ok("X-Powered-By header is not exposed");
  else fail("X-Powered-By header", h.get("x-powered-by"));

  if (h.get("x-request-id")) ok("X-Request-Id correlation header is present");
  else fail("X-Request-Id correlation header is present");

  // 2) CORS preflight honors the configured allowlist.
  const preflightAllowed = await rawFetch("/api/auth/login", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
  });
  if (
    preflightAllowed.status === 204 &&
    preflightAllowed.headers.get("access-control-allow-origin") === "http://localhost:5173"
  ) {
    ok("CORS preflight echoes allowed origin");
  } else {
    fail("CORS preflight echoes allowed origin", preflightAllowed.headers.get("access-control-allow-origin"));
  }

  const preflightDenied = await rawFetch("/api/auth/login", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example.com", "Access-Control-Request-Method": "POST" },
  });
  if (
    preflightDenied.status === 204 &&
    preflightDenied.headers.get("access-control-allow-origin") === null
  ) {
    ok("CORS preflight does not echo disallowed origin");
  } else {
    fail("CORS preflight blocks disallowed origin", {
      status: preflightDenied.status,
      acao: preflightDenied.headers.get("access-control-allow-origin"),
    });
  }

  // 3) Login still works — proves tokens signed with the pinned claims verify.
  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (login.status !== 200 || !login.body || typeof login.body !== "object") {
    fail("admin login with hardened JWT", login);
    return;
  }
  const adminToken = (login.body as { data: { token: string } }).data.token;
  ok("admin login returns token with pinned JWT claims");

  const meAuthed = await request("/auth/me", {}, adminToken);
  const meBody = meAuthed.body as { data?: { email?: string } };
  if (meAuthed.status === 200 && meBody.data?.email === "admin@vigilens.io") {
    ok("hardened token authenticates a protected request");
  } else {
    fail("hardened token authenticates a protected request", meAuthed);
  }

  // 4) Algorithm pinning rejects an unsigned "none" token.
  const noneToken = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ userId: "nobody", role: "admin" })}.`;
  const noneAttempt = await request("/auth/me", {}, noneToken);
  if (noneAttempt.status === 401) {
    ok("algorithm pinning rejects alg=none tokens (401)");
  } else {
    fail("algorithm pinning rejects alg=none tokens", noneAttempt.status);
  }

  // 5) Issuer/audience pinning rejects a token bound to other claims.
  const stubSecret = process.env.JWT_SECRET || "dev-secret-change-in-production";
  const adminId = (meBody.data as { id?: string }).id;
  const rogue = jwt.sign(
    { userId: adminId ?? "nobody", role: "admin" },
    stubSecret,
    { algorithm: "HS256", issuer: "other-issuer", audience: "other-audience" },
  );
  const rogueAttempt = await request("/auth/me", {}, rogue);
  if (rogueAttempt.status === 401) {
    ok("issuer/audience pinning rejects borrowed-claim tokens (401)");
  } else {
    fail("issuer/audience pinning rejects borrowed-claim tokens", rogueAttempt.status);
  }

  // 6) CORS_ORIGIN env knob overrides the hardcoded allowlist.
  killProcessTree(server);
  await sleep(1500);
  server = spawnServer({ CORS_ORIGIN: "https://api.example.com" });
  if (!(await waitForServer())) {
    fail("second server startup (CORS_ORIGIN override)", "backend not healthy");
    return;
  }
  const knobAllowed = await rawFetch("/api/auth/login", {
    method: "OPTIONS",
    headers: { Origin: "https://api.example.com", "Access-Control-Request-Method": "POST" },
  });
  const knobDenied = await rawFetch("/api/auth/login", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
  });
  if (
    knobAllowed.headers.get("access-control-allow-origin") === "https://api.example.com" &&
    knobDenied.headers.get("access-control-allow-origin") === null
  ) {
    ok("CORS_ORIGIN env overrides the default origin allowlist");
  } else {
    fail("CORS_ORIGIN env overrides allowlist", {
      allowed: knobAllowed.headers.get("access-control-allow-origin"),
      denied: knobDenied.headers.get("access-control-allow-origin"),
    });
  }
}

run()
  .catch((err) => fail("security header test crash", String(err)))
  .finally(() => {
    if (server) killProcessTree(server);
    console.log(`\nSecurity header tests: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });