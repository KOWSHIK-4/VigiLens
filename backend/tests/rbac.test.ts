import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";

const TEST_PORT_BASE = 5021;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

const prisma = new PrismaClient();
let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const createdUserIds: string[] = [];
const createdRoleNames: string[] = [];

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
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdRoleNames.length > 0) {
      await prisma.role.deleteMany({ where: { name: { in: createdRoleNames } } });
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

  console.log(`Starting backend server on port ${TEST_PORT} for RBAC API tests...`);
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

  async function login(email: string, password = "admin123") {
    const res = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res as { status: number; body: { data: { token: string; user: Record<string, unknown> } } | null };
  }

  const superLogin = await login("super@vigilens.io");
  if (superLogin.status !== 200) {
    fail("super login", superLogin);
    return;
  }
  const superToken = superLogin.body!.data.token;
  ok("super admin login");

  const adminLogin = await login("admin@vigilens.io");
  const adminToken = adminLogin.body!.data.token;
  ok("admin login");

  const operatorLogin = await login("operator@vigilens.io");
  const operatorToken = operatorLogin.body!.data.token;
  ok("operator login");

  const viewerLogin = await login("viewer@vigilens.io");
  const viewerToken = viewerLogin.body!.data.token;
  ok("viewer login");

  if (
    !Array.isArray(superLogin.body!.data.user.permissions) ||
    superLogin.body!.data.user.permissions.length === 0
  ) {
    fail("me payload includes permissions", superLogin.body!.data.user.permissions);
  } else {
    ok("login response includes role permissions array");
  }

  // ---- Role CRUD ----
  const roleName = `analyst_${Date.now()}`;
  const roleEmail = `rbac_${Date.now()}@vigilens.io`;

  const createdRole = await request(
    "/roles",
    {
      method: "POST",
      body: JSON.stringify({
        name: roleName,
        description: "Temporary analyst role",
        permissionKeys: ["dashboard.view", "cameras.read", "detections.read"],
      }),
    },
    superToken,
  );
  if (
    createdRole.status === 201 &&
    (createdRole.body as { data: { name: string; isSystem: boolean } }).data.name === roleName &&
    (createdRole.body as { data: { isSystem: boolean } }).data.isSystem === false
  ) {
    createdRoleNames.push(roleName);
    ok("POST /roles creates a custom role");
  } else {
    fail("POST /roles create", createdRole);
  }

  const dupRole = await request(
    "/roles",
    {
      method: "POST",
      body: JSON.stringify({ name: roleName, permissionKeys: [] }),
    },
    superToken,
  );
  if (dupRole.status === 409) {
    ok("POST /roles rejects duplicate names (409)");
  } else {
    fail("POST /roles duplicate guard", dupRole);
  }

  const badKeyRole = await request(
    "/roles",
    {
      method: "POST",
      body: JSON.stringify({ name: `bad_${Date.now()}`, permissionKeys: ["not.a.key"] }),
    },
    superToken,
  );
  if (badKeyRole.status === 400) {
    ok("POST /roles rejects unknown permission keys (400)");
  } else {
    fail("POST /roles permission key validation", badKeyRole);
  }

  const badNameRole = await request(
    "/roles",
    {
      method: "POST",
      body: JSON.stringify({ name: "Bad Role!", permissionKeys: [] }),
    },
    superToken,
  );
  if (badNameRole.status === 400) {
    ok("POST /roles rejects invalid role names (400)");
  } else {
    fail("POST /roles name validation", badNameRole);
  }

  const roleList = await request("/roles", {}, superToken);
  const roleListBody = roleList.body as { data: Array<{ name: string; isSystem: boolean }> };
  const customInList = roleListBody.data.find((r) => r.name === roleName);
  if (
    roleList.status === 200 &&
    customInList &&
    customInList.isSystem === false
  ) {
    ok("GET /roles includes the custom role flagged as non-system");
  } else {
    fail("GET /roles custom role", roleList);
  }

  const allPerms = await request("/roles/permissions", {}, superToken);
  const permBody = allPerms.body as { data: Array<{ key: string; category: string }> };
  const permKeys = new Set(permBody.data?.map((p) => p.key));
  const needsAll = [
    "users.read",
    "users.manage",
    "roles.manage",
    "cameras.control",
    "reports.generate",
    "audit.export",
  ];
  if (
    allPerms.status === 200 &&
    permBody.data?.length >= 30 &&
    needsAll.every((k) => permKeys.has(k))
  ) {
    ok("GET /roles/permissions returns the full permission catalog");
  } else {
    fail("GET /roles/permissions", allPerms);
  }

  const viewerPerms = await request("/roles/permissions", {}, viewerToken);
  if (viewerPerms.status === 403) {
    ok("viewer cannot list permission catalog (403)");
  } else {
    fail("viewer permission catalog guard", viewerPerms);
  }

  const updateRole = await request(
    `/roles/${roleName}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        description: "Updated description",
        permissionKeys: ["dashboard.view", "cameras.read", "detections.read", "alerts.read"],
      }),
    },
    superToken,
  );
  if (updateRole.status === 200) {
    ok("PATCH /roles/:name updates description and permissions");
  } else {
    fail("PATCH /roles/:name", updateRole);
  }

  const deleteSystemRole = await request("/roles/viewer", { method: "DELETE" }, superToken);
  if (deleteSystemRole.status === 400) {
    ok("DELETE /roles/:name blocks system role deletion (400)");
  } else {
    fail("system role delete guard", deleteSystemRole);
  }

  // ---- User lifecycle with custom role ----
  const createdUser = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "RBAC Tester",
        email: roleEmail,
        password: "password123",
        role: roleName,
      }),
    },
    superToken,
  );
  if (createdUser.status !== 201) {
    fail("POST /users with custom role", createdUser);
    return;
  }
  const userId = (createdUser.body as { data: { id: string } }).data.id;
  createdUserIds.push(userId);
  ok("POST /users assigns a custom role");

  const deleteInUseRole = await request(`/roles/${roleName}`, { method: "DELETE" }, superToken);
  if (deleteInUseRole.status === 400) {
    ok("DELETE /roles/:name blocks roles with active users (400)");
  } else {
    fail("in-use role delete guard", deleteInUseRole);
  }

  // ---- Lock / unlock ----
  const lock = await request(`/users/${userId}/lock`, { method: "POST" }, superToken);
  if (
    lock.status === 200 &&
    (lock.body as { data: { isLocked: boolean } }).data.isLocked === true
  ) {
    ok("POST /users/:id/lock locks the user");
  } else {
    fail("POST /users/:id/lock", lock);
  }

  const lockedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: roleEmail, password: "password123" }),
  });
  if (lockedLogin.status === 403) {
    ok("locked user cannot log in (403)");
  } else {
    fail("locked login guard", lockedLogin);
  }

  const unlock = await request(`/users/${userId}/unlock`, { method: "POST" }, superToken);
  if (
    unlock.status === 200 &&
    (unlock.body as { data: { isLocked: boolean } }).data.isLocked === false
  ) {
    ok("POST /users/:id/unlock unlocks the user");
  } else {
    fail("POST /users/:id/unlock", unlock);
  }

  const afterUnlockLogin = await login(roleEmail, "password123");
  if (afterUnlockLogin.status === 200) {
    ok("unlocked user can log in again");
  } else {
    fail("unlocked login", afterUnlockLogin);
  }

  const selfLock = await request(`/users/${superLogin.body!.data.user.id}/lock`, { method: "POST" }, superToken);
  if (selfLock.status === 400) {
    ok("locking your own account is blocked (400)");
  } else {
    fail("self-lock guard", selfLock);
  }

  const selfUnlock = await request(`/users/${superLogin.body!.data.user.id}/unlock`, { method: "POST" }, superToken);
  if (selfUnlock.status === 400) {
    ok("unlocking your own account is blocked (400)");
  } else {
    fail("self-unlock guard", selfUnlock);
  }

  const operatorLock = await request(`/users/${userId}/lock`, { method: "POST" }, operatorToken);
  if (operatorLock.status === 403) {
    ok("operator cannot lock users (403)");
  } else {
    fail("operator lock guard", operatorLock);
  }

  const adminLock = await request(`/users/${userId}/lock`, { method: "POST" }, adminToken);
  if (adminLock.status === 200) {
    ok("admin can lock users");
  } else {
    fail("admin lock", adminLock);
  }
  await request(`/users/${userId}/unlock`, { method: "POST" }, superToken);

  // ---- Auto-lockout after repeated failures ----
  const victimEmail = `lockout_${Date.now()}@vigilens.io`;
  const victim = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({ name: "Lockout Victim", email: victimEmail, password: "password123" }),
    },
    superToken,
  );
  const victimId = (victim.body as { data: { id: string } }).data.id;
  createdUserIds.push(victimId);

  let fifthRejected = false;
  for (let i = 0; i < 5; i += 1) {
    const attempt = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: victimEmail, password: "wrongpassword" }),
    });
    if (attempt.status !== 401) {
      fail("auto lockout", `attempt ${i + 1} expected 401, got ${attempt.status}`);
      break;
    }
    if (i === 4) fifthRejected = true;
  }
  if (fifthRejected) {
    ok("all 5 failed login attempts are rejected (401)");
  } else {
    fail("auto lockout", "expected all attempts to be rejected");
  }

  const correctAfterLockout = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: victimEmail, password: "password123" }),
  });
  if (correctAfterLockout.status === 403) {
    ok("locked account rejects the correct password until unlocked");
  } else {
    fail("correct password after lockout", correctAfterLockout);
  }

  const victimDetail = await request(`/users/${victimId}`, {}, superToken);
  if (
    victimDetail.status === 200 &&
    (victimDetail.body as { data: { isLocked: boolean; failedLoginAttempts: number } }).data.isLocked === true &&
    (victimDetail.body as { data: { failedLoginAttempts: number } }).data.failedLoginAttempts >= 5
  ) {
    ok("locked account reports isLocked and failedLoginAttempts");
  } else {
    fail("locked account state", victimDetail);
  }

  const unlockVictim = await request(`/users/${victimId}/unlock`, { method: "POST" }, superToken);
  if (unlockVictim.status === 200) {
    ok("unlock resets the account");
  } else {
    fail("unlock victim", unlockVictim);
  }

  // ---- Reset password with forced change ----
  const forcedEmail = `forced_${Date.now()}@vigilens.io`;
  const forcedUser = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({ name: "Forced Change", email: forcedEmail, password: "password123" }),
    },
    superToken,
  );
  const forcedId = (forcedUser.body as { data: { id: string } }).data.id;
  createdUserIds.push(forcedId);

  const resetPw = await request(
    `/users/${forcedId}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({ password: "newpass1234", mustChangePassword: true }),
    },
    superToken,
  );
  if (
    resetPw.status === 200 &&
    (resetPw.body as { data: { success: boolean } }).data.success === true
  ) {
    ok("POST /users/:id/reset-password sets a new password");
  } else {
    fail("POST /users/:id/reset-password", resetPw);
  }

  const forcedLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: forcedEmail, password: "newpass1234" }),
  });
  const forcedToken = forcedLogin.status === 200 ? (forcedLogin.body as { data: { token: string } }).data.token : null;
  if (
    forcedLogin.status === 200 &&
    (forcedLogin.body as { data: { user: { mustChangePassword: boolean } } }).data.user.mustChangePassword === true
  ) {
    ok("login after forced reset flags mustChangePassword");
  } else {
    fail("forced reset login", forcedLogin);
  }

  const blockedAccess = await request("/cameras?page=1&limit=5", {}, forcedToken);
  if (
    blockedAccess.status === 403 &&
    (blockedAccess.body as { code?: string })?.code === "PASSWORD_CHANGE_REQUIRED"
  ) {
    ok("user must change password before accessing resources");
  } else {
    fail("forced password gate", blockedAccess);
  }

  const meWhileForced = await request("/auth/me", {}, forcedToken);
  if (meWhileForced.status === 200) {
    ok("me endpoint remains available while password change is required");
  } else {
    fail("me during forced password", meWhileForced);
  }

  const wrongCurrent = await request(
    "/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({ currentPassword: "totallywrong", newPassword: "finalpass99" }),
    },
    forcedToken,
  );
  if (wrongCurrent.status === 400) {
    ok("change-password rejects an incorrect current password (400)");
  } else {
    fail("change-password wrong current", wrongCurrent);
  }

  const changePw = await request(
    "/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({ currentPassword: "newpass1234", newPassword: "finalpass99" }),
    },
    forcedToken,
  );
  if (changePw.status === 200) {
    ok("change-password succeeds with the correct current password");
  } else {
    fail("change-password", changePw);
  }

  const meAfterChange = await request("/auth/me", {}, forcedToken);
  if (
    meAfterChange.status === 200 &&
    (meAfterChange.body as { data: { mustChangePassword: boolean } }).data.mustChangePassword === false
  ) {
    ok("mustChangePassword clears after password change");
  } else {
    fail("me after password change", meAfterChange);
  }

  const accessAfterChange = await request("/cameras?page=1&limit=5", {}, forcedToken);
  if (accessAfterChange.status === 200) {
    ok("resource access restored after password change");
  } else {
    fail("access after password change", accessAfterChange);
  }

  const shortReset = await request(
    `/users/${forcedId}/reset-password`,
    { method: "POST", body: JSON.stringify({ password: "short" }) },
    superToken,
  );
  if (shortReset.status === 400) {
    ok("reset-password rejects short passwords (400)");
  } else {
    fail("reset-password validation", shortReset);
  }

  const viewerReset = await request(
    `/users/${forcedId}/reset-password`,
    { method: "POST", body: JSON.stringify({ password: "newpass5678" }) },
    viewerToken,
  );
  if (viewerReset.status === 403) {
    ok("viewer cannot reset passwords (403)");
  } else {
    fail("viewer reset guard", viewerReset);
  }

  // ---- Detection deletion (detections.manage) ----
  const ingest = await request("/detections/internal", {
    method: "POST",
    body: JSON.stringify({
      camera_id: "demo-camera-1",
      label: "person",
      confidence: 0.8,
      image_url: "/tmp/rbac_test.jpg",
      detector_key: "person",
      class_name: "person",
      track_id: "rbac-1",
      bounding_box: { x1: 1, y1: 2, x2: 3, y2: 4 },
      metadata: { source: "rbac-test" },
    }),
  });
  const detectionId = (ingest.body as { data?: { id?: string } })?.data?.id;
  if (ingest.status !== 201 || !detectionId) {
    fail("POST /detections/internal seeds a detection for delete tests", ingest);
  } else {
    ok("POST /detections/internal seeds a detection for delete tests");

    const viewerDelete = await request(`/detections/${detectionId}`, { method: "DELETE" }, viewerToken);
    if (viewerDelete.status === 403) {
      ok("viewer cannot delete detections (403)");
    } else {
      fail("viewer cannot delete detections", viewerDelete);
    }

    const operatorDelete = await request(`/detections/${detectionId}`, { method: "DELETE" }, operatorToken);
    if (operatorDelete.status === 403) {
      ok("operator cannot delete detections (403)");
    } else {
      fail("operator cannot delete detections", operatorDelete);
    }

    const adminDelete = await request(`/detections/${detectionId}`, { method: "DELETE" }, adminToken);
    if (adminDelete.status === 200) {
      ok("admin can delete detections (detections.manage)");
    } else {
      fail("admin can delete detections", adminDelete);
    }

    const secondDelete = await request(`/detections/${detectionId}`, { method: "DELETE" }, adminToken);
    if (secondDelete.status === 404) {
      ok("deleting an already-deleted detection returns 404");
    } else {
      fail("deleting an already-deleted detection", secondDelete);
    }
  }

  const unauthDelete = await request(`/detections/${detectionId ?? "missing"}`, { method: "DELETE" });
  if (unauthDelete.status === 401) {
    ok("unauthenticated delete detection is rejected (401)");
  } else {
    fail("unauthenticated delete detection", unauthDelete);
  }

  // ---- Soft delete + role cleanup ----
  const removed = await request(`/users/${userId}`, { method: "DELETE" }, superToken);
  if (removed.status === 200) {
    ok("DELETE /users/:id soft-deletes the user");
  } else {
    fail("DELETE /users/:id", removed);
  }

  const deletedGone = await request(`/users/${userId}`, {}, superToken);
  if (deletedGone.status === 404) {
    ok("soft-deleted user is no longer returned (404)");
  } else {
    fail("GET deleted user", deletedGone);
  }

  const deleteRoleAfterDelete = await request(`/roles/${roleName}`, { method: "DELETE" }, superToken);
  if (deleteRoleAfterDelete.status === 200) {
    ok("role can be deleted once its users are soft-deleted (reassigned)");
  } else {
    fail("delete role after soft delete", deleteRoleAfterDelete);
  }

  // ---- Stats include locked count ----
  const stats = await request("/users/stats", {}, superToken);
  const statsBody = stats.body as { data: { locked: number; total: number } };
  if (
    stats.status === 200 &&
    typeof statsBody.data?.locked === "number" &&
    statsBody.data.total >= 5
  ) {
    ok("GET /users/stats includes a locked count");
  } else {
    fail("GET /users/stats locked", stats);
  }
}

async function main() {
  try {
    await run();
  } catch (err) {
    failed += 1;
    console.error("Unexpected test error:", err);
  } finally {
    await cleanupDb();
    if (server) {
      killProcessTree(server);
      await sleep(1500);
    }
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

void main();
