import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { generateSync } from "otplib";
import { PrismaClient } from "@prisma/client";

const TEST_PORT_BASE = 5091;
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
    // Belt-and-suspenders: the seeded admin must be left MFA-free no matter
    // how this suite exits, or every later suite in the chain breaks.
    await prisma.user.updateMany({
      where: { email: "admin@vigilens.io" },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
    });
    // Drop any overrides this suite may have left behind so the security
    // settings fall back to their defaults (enforcement off, 30min timeout).
    await prisma.systemSetting.deleteMany({
      where: {
        organizationId: "",
        category: "security",
        key: { in: ["mfa_enforced", "session_timeout_minutes"] },
      },
    });
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

  console.log(`Starting backend server on port ${TEST_PORT} for MFA/session tests...`);
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

  // Security settings are instance-wide: only a Super Admin may tune them,
  // matching the production authorization boundary.
  const superLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "super@vigilens.io", password: "admin123" }),
  });
  const superToken =
    superLogin.status === 200
      ? (superLogin.body as { data: { token: string } }).data.token
      : "";

  // Registration is closed by default; open it for the account we create.
  await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ allow_registration: true }) },
    superToken,
  );

  const mfaEmail = `mfa_${Date.now()}@vigilens.io`;
  const mfaPassword = "MfaPass99!";
  createdUserEmails.push(mfaEmail);
  const mfaRegister = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "MFA User", email: mfaEmail, password: mfaPassword }),
  });
  if (mfaRegister.status === 201) {
    ok("mfa test user registers (201)");
  } else {
    fail("mfa user register", mfaRegister);
    return;
  }

  const firstLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
  });
  const mfaToken =
    firstLogin.status === 200
      ? (firstLogin.body as { data: { token: string } }).data.token
      : "";
  if (firstLogin.status === 200) {
    ok("login succeeds before MFA is enabled");
  } else {
    fail("pre-enrollment login", firstLogin);
    return;
  }

  // ---- Enrollment: setup -> verify -> recovery codes ----
  const setup = await request("/auth/mfa/setup", { method: "POST" }, mfaToken);
  if (setup.status === 200) {
    ok("mfa setup returns a provisioning pair");
  } else {
    fail("mfa setup", setup);
    return;
  }
  const { secret, otpauthUrl } = (setup.body as { data: { secret: string; otpauthUrl: string } }).data;
  if (typeof secret === "string" && secret.length >= 16 && otpauthUrl.startsWith("otpauth://")) {
    ok("setup returns a verifiable secret and otpauth URI");
  } else {
    fail("setup payload shape", { secret, otpauthUrl });
  }

  const badVerify = await request(
    "/auth/mfa/verify",
    { method: "POST", body: JSON.stringify({ code: "000000" }) },
    mfaToken,
  );
  if (badVerify.status === 400) {
    ok("mfa verify rejects a wrong code");
  } else {
    fail("mfa verify wrong code", badVerify);
  }

  const verifyCode = generateSync({ secret });
  const enroll = await request(
    "/auth/mfa/verify",
    { method: "POST", body: JSON.stringify({ code: verifyCode }) },
    mfaToken,
  );
  if (enroll.status === 200 && (enroll.body as { data: { enabled: boolean } }).data.enabled === true) {
    ok("mfa verify with the live TOTP enables the account");
  } else {
    fail("mfa verify", enroll);
    return;
  }
  const recoveryCodes = (enroll.body as { data: { recoveryCodes: string[] } }).data.recoveryCodes;
  if (Array.isArray(recoveryCodes) && recoveryCodes.length >= 8) {
    ok(`enrollment returns ${recoveryCodes.length} single-use recovery codes`);
  } else {
    fail("recovery codes shape", recoveryCodes);
  }
  const firstRecovery = recoveryCodes[0];

  const me = await request("/auth/me", {}, mfaToken);
  if (
    me.status === 200 &&
    (me.body as { data: { mfaEnabled: boolean } }).data.mfaEnabled === true
  ) {
    ok("me reflects mfaEnabled after enrollment");
  } else {
    fail("me after enrollment", me);
  }

  // ---- Login challenge behaviour ----
  const missingCode = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
  });
  if (
    missingCode.status === 401 &&
    (missingCode.body as { code?: string }).code === "MFA_REQUIRED"
  ) {
    ok("password-only login prompts with MFA_REQUIRED");
  } else {
    fail("login missing code", missingCode);
  }

  const totpLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword, totpCode: generateSync({ secret }) }),
  });
  if (totpLogin.status === 200 && (totpLogin.body as { data: { token: string } }).data.token) {
    ok("login with a valid TOTP succeeds");
  } else {
    fail("login with TOTP", totpLogin);
  }

  const wrongTotp = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword, totpCode: "123456" }),
  });
  if (wrongTotp.status === 401 && (wrongTotp.body as { error?: string }).error === "Invalid MFA code") {
    ok("login with an invalid TOTP is rejected");
  } else {
    fail("login with wrong TOTP", wrongTotp);
  }

  const recoveryLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword, recoveryCode: firstRecovery }),
  });
  if (recoveryLogin.status === 200) {
    ok("login with a recovery code succeeds");
  } else {
    fail("login with recovery code", recoveryLogin);
  }

  const replayRecovery = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword, recoveryCode: firstRecovery }),
  });
  if (replayRecovery.status === 401) {
    ok("a recovery code is consumed on first use");
  } else {
    fail("replayed recovery code", replayRecovery);
  }

  // ---- MFA enforcement policy ----
  const enforceOn = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ mfa_enforced: true }) },
    superToken,
  );
  if (enforceOn.status === 200) {
    ok("mfa_enforced can be turned on");
  } else {
    fail("enable mfa_enforced", enforceOn);
  }

  const enforcedUserEmail = `mfa_enforced_${Date.now()}@vigilens.io`;
  createdUserEmails.push(enforcedUserEmail);
  await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "No MFA User", email: enforcedUserEmail, password: "MfaPass99!" }),
  });
  const enforcedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: enforcedUserEmail, password: "MfaPass99!" }),
  });
  const enforcedToken =
    enforcedLogin.status === 200
      ? (enforcedLogin.body as { data: { token: string } }).data.token
      : "";
  const gatedCall = await request("/auth/realtime-ticket", { method: "POST" }, enforcedToken);
  if (
    gatedCall.status === 403 &&
    (gatedCall.body as { code?: string }).code === "MFA_ENROLLMENT_REQUIRED"
  ) {
    ok("unenrolled user is gated to enrollment flow once MFA is enforced");
  } else {
    fail("mfa enforced gating", gatedCall);
  }

  const gatedMe = await request("/auth/me", {}, enforcedToken);
  if (gatedMe.status === 200) {
    ok("unenrolled user can still reach /auth/me while enforced");
  } else {
    fail("gated me while enforced", gatedMe);
  }

  const totpLoginToken = (totpLogin.body as { data: { token: string } }).data.token;
  const enrolledCall = await request("/auth/realtime-ticket", { method: "POST" }, totpLoginToken);
  if (enrolledCall.status === 200) {
    ok("enrolled user is unaffected by MFA enforcement");
  } else {
    fail("enrolled user while enforced", enrolledCall);
  }

  // The enforcement flag gates every un-enrolled account, so even the Super
  // Admin must enroll before it can turn the policy back off (the real
  // operator workflow). Tenant admins cannot change instance-wide settings.
  const adminSetup = await request("/auth/mfa/setup", { method: "POST" }, adminToken);
  const adminVerify = await request(
    "/auth/mfa/verify",
    {
      method: "POST",
      body: JSON.stringify({ code: generateSync({ secret: (adminSetup.body as { data: { secret: string } }).data.secret }) }),
    },
    adminToken,
  );
  if (adminVerify.status === 200 && (adminVerify.body as { data: { enabled: boolean } }).data.enabled === true) {
    ok("enrolled admin can complete the enforced-enrollment flow");
  } else {
    fail("admin enrollment while enforced", adminVerify);
  }
  const superSetup = await request("/auth/mfa/setup", { method: "POST" }, superToken);
  const superVerify = await request(
    "/auth/mfa/verify",
    {
      method: "POST",
      body: JSON.stringify({ code: generateSync({ secret: (superSetup.body as { data: { secret: string } }).data.secret }) }),
    },
    superToken,
  );
  if (superVerify.status === 200 && (superVerify.body as { data: { enabled: boolean } }).data.enabled === true) {
    ok("enrolled super admin can complete the enforced-enrollment flow");
  } else {
    fail("super enrollment while enforced", superVerify);
  }
  const enforceOff = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ mfa_enforced: false }) },
    superToken,
  );
  if (enforceOff.status === 200) {
    ok("mfa_enforced can be turned back off by an enrolled super admin");
  } else {
    fail("disable mfa_enforced", enforceOff);
  }
  const superUnenroll = await request(
    "/auth/mfa/disable",
    { method: "POST", body: JSON.stringify({ password: "admin123" }) },
    superToken,
  );
  if (superUnenroll.status === 200) {
    ok("super admin MFA is disabled again so later suites are unaffected");
  } else {
    fail("super admin mfa disable", superUnenroll);
  }
  const adminUnenroll = await request(
    "/auth/mfa/disable",
    { method: "POST", body: JSON.stringify({ password: "admin123" }) },
    adminToken,
  );
  if (adminUnenroll.status === 200) {
    ok("admin MFA is disabled again so later suites are unaffected");
  } else {
    fail("admin mfa disable", adminUnenroll);
  }

  // ---- Disable ----
  const wrongPasswordDisable = await request(
    "/auth/mfa/disable",
    { method: "POST", body: JSON.stringify({ password: "WrongPass99!" }) },
    mfaToken,
  );
  if (wrongPasswordDisable.status === 400) {
    ok("mfa disable refuses the wrong password");
  } else {
    fail("mfa disable wrong password", wrongPasswordDisable);
  }

  const disable = await request(
    "/auth/mfa/disable",
    { method: "POST", body: JSON.stringify({ password: mfaPassword }) },
    mfaToken,
  );
  if (disable.status === 200 && (disable.body as { data: { enabled: boolean } }).data.enabled === false) {
    ok("mfa disable clears the second factor");
  } else {
    fail("mfa disable", disable);
  }

  const postDisableLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
  });
  if (postDisableLogin.status === 200) {
    ok("password-only login works again after disable");
  } else {
    fail("login after disable", postDisableLogin);
  }

  // ---- Session inactivity window (sliding) ----
  const timeoutUpdate = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ session_timeout_minutes: 5 }) },
    superToken,
  );
  if (timeoutUpdate.status === 200) {
    ok("session_timeout_minutes can be lowered to the minimum");
  } else {
    fail("session timeout update", timeoutUpdate);
  }

  const sessionLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
  });
  const sessionToken =
    sessionLogin.status === 200
      ? (sessionLogin.body as { data: { token: string } }).data.token
      : "";
  const decodedToken = jwt.decode(sessionToken) as (JwtPayload & { sid?: string }) | null;
  if (decodedToken?.sid) {
    ok("issued token carries the session id (sid) claim");
  } else {
    fail("token sid claim", decodedToken);
  }

  const active = await request("/auth/me", {}, sessionToken);
  if (active.status === 200) {
    ok("active session is accepted inside the inactivity window");
  } else {
    fail("active session", active);
  }

  if (decodedToken?.sid) {
    // Simulate a user who has been idle past the 5-minute window.
    await prisma.userSession.updateMany({
      where: { id: decodedToken.sid },
      data: { lastActivityAt: new Date(Date.now() - 10 * 60_000) },
    });
    const idle = await request("/auth/me", {}, sessionToken);
    if (idle.status === 401 && (idle.body as { error?: string }).error.includes("Session expired")) {
      ok("an idle session past the inactivity window is rejected");
    } else {
      fail("idle session", idle);
    }

    // A fresh request slides lastActivityAt forward, keeping the session alive.
    const slideLogin = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: mfaEmail, password: mfaPassword }),
    });
    const slideToken = (slideLogin.body as { data: { token: string } }).data.token;
    const slideDecoded = jwt.decode(slideToken) as (JwtPayload & { sid?: string }) | null;
    const before = await prisma.userSession.findUnique({
      where: { id: slideDecoded?.sid },
      select: { lastActivityAt: true },
    });
    await sleep(1100);
    await request("/auth/me", {}, slideToken);
    const after = await prisma.userSession.findUnique({
      where: { id: slideDecoded?.sid },
      select: { lastActivityAt: true },
    });
    if (after && after.lastActivityAt > (before?.lastActivityAt ?? new Date(0))) {
      ok("request activity slides the inactivity timestamp forward");
    } else {
      fail("sliding activity", { before, after });
    }
  }

  // ---- Restore defaults so later suites in the chain are unaffected ----
  const resetSettings = await request(
    "/settings/security/reset",
    { method: "POST" },
    superToken,
  );
  if (resetSettings.status === 200) {
    ok("security settings reset to defaults");
  } else {
    fail("settings reset", resetSettings);
  }

  console.log(`\nMFA/session policy tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().finally(() => {
  if (server) killProcessTree(server);
  cleanupDb().finally(() => prisma.$disconnect().catch(() => undefined));
});