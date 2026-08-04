import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT = 4821 + (process.pid % 500);
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
    fail("test port reservation", `port ${TEST_PORT} already in use`);
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for user API tests...`);
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

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "super@vigilens.io", password: "admin123" }),
  });
  if (login.status !== 200 || !login.body || typeof login.body !== "object") {
    fail("super admin login", login);
    return;
  }
  const superToken = (login.body as { data: { token: string } }).data.token;
  ok("super admin login returns token");

  const adminLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (adminLogin.status !== 200) {
    fail("admin login", adminLogin);
    return;
  }
  const adminToken = (adminLogin.body as { data: { token: string } }).data.token;
  ok("admin login returns token");

  const viewerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "viewer@vigilens.io", password: "admin123" }),
  });
  if (viewerLogin.status !== 200) {
    fail("viewer login", viewerLogin);
    return;
  }
  const viewerToken = (viewerLogin.body as { data: { token: string } }).data.token;
  ok("viewer login returns token");

  const operatorLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "operator@vigilens.io", password: "admin123" }),
  });
  if (operatorLogin.status !== 200) {
    fail("operator login", operatorLogin);
    return;
  }
  const operatorToken = (operatorLogin.body as { data: { token: string } }).data.token;
  ok("operator login returns token");

  const disabledLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "disabled@vigilens.io", password: "admin123" }),
  });
  if (disabledLogin.status === 401) {
    ok("disabled account cannot log in (401)");
  } else {
    fail("disabled account login guard", disabledLogin);
  }

  const list = await request("/users?page=1&limit=100", {}, superToken);
  if (list.status !== 200) {
    fail("GET /users", list);
    return;
  }
  const listBody = list.body as { total: number; data: Array<{ email: string; password?: string }> };
  if (listBody.total >= 5 && listBody.data.every((u) => !("password" in u))) {
    ok(`GET /users returns seeded users without password hashes (total=${listBody.total})`);
  } else {
    fail("GET /users payload", listBody);
  }

  const stats = await request("/users/stats", {}, superToken);
  if (
    stats.status === 200 &&
    (stats.body as { data: { total: number; disabled: number } }).data.total >= 5 &&
    (stats.body as { data: { disabled: number } }).data.disabled >= 1
  ) {
    ok("GET /users/stats returns totals with disabled count");
  } else {
    fail("GET /users/stats", stats);
  }

  const email = `test_${Date.now()}@vigilens.io`;
  const created = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Test User",
        email,
        password: "password123",
        role: "operator",
      }),
    },
    superToken,
  );
  if (created.status !== 201) {
    fail("POST /users create", created);
    return;
  }
  const createdBody = created.body as { data: { id: string; role: string; status: string } };
  const userId = createdBody.data.id;
  if (createdBody.data.role === "operator" && createdBody.data.status === "active") {
    ok("POST /users creates user with role and active status");
  } else {
    fail("POST /users payload", createdBody);
  }

  const dup = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({ name: "Dup", email, password: "password123" }),
    },
    superToken,
  );
  if (dup.status === 409) {
    ok("POST /users rejects duplicate email (409)");
  } else {
    fail("POST /users duplicate guard", dup);
  }

  const invalid = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({ name: "X", email: "not-an-email", password: "short" }),
    },
    superToken,
  );
  if (invalid.status === 400) {
    ok("POST /users validates input (400)");
  } else {
    fail("POST /users validation", invalid);
  }

  const byId = await request(`/users/${userId}`, {}, superToken);
  if (byId.status === 200 && (byId.body as { data: { email: string } }).data.email === email) {
    ok("GET /users/:id returns the created user");
  } else {
    fail("GET /users/:id", byId);
  }

  const updated = await request(
    `/users/${userId}`,
    { method: "PATCH", body: JSON.stringify({ name: "Renamed User" }) },
    superToken,
  );
  if (
    updated.status === 200 &&
    (updated.body as { data: { name: string } }).data.name === "Renamed User"
  ) {
    ok("PATCH /users/:id updates profile fields");
  } else {
    fail("PATCH /users/:id", updated);
  }

  const roleChanged = await request(
    `/users/${userId}/role`,
    { method: "PATCH", body: JSON.stringify({ role: "viewer" }) },
    superToken,
  );
  if (
    roleChanged.status === 200 &&
    (roleChanged.body as { data: { role: string } }).data.role === "viewer"
  ) {
    ok("PATCH /users/:id/role assigns the viewer role");
  } else {
    fail("PATCH /users/:id/role", roleChanged);
  }

  const badRole = await request(
    `/users/${userId}/role`,
    { method: "PATCH", body: JSON.stringify({ role: "god" }) },
    superToken,
  );
  if (badRole.status === 400) {
    ok("PATCH /users/:id/role rejects unknown roles (400)");
  } else {
    fail("role validation", badRole);
  }

  const disabled = await request(
    `/users/${userId}/status`,
    { method: "PATCH", body: JSON.stringify({ status: "disabled" }) },
    superToken,
  );
  if (
    disabled.status === 200 &&
    (disabled.body as { data: { status: string } }).data.status === "disabled"
  ) {
    ok("PATCH /users/:id/status disables the user");
  } else {
    fail("PATCH /users/:id/status", disabled);
  }

  const disabledUserLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (disabledUserLogin.status === 401) {
    ok("newly disabled user cannot log in");
  } else {
    fail("newly disabled user login guard", disabledUserLogin);
  }

  const search = await request(`/users?search=Renamed&role=viewer&status=disabled`, {}, superToken);
  if (search.status === 200 && (search.body as { total: number }).total === 1) {
    ok("GET /users filters by search, role and status");
  } else {
    fail("GET /users filters", search);
  }

  const selfDeleteReal = await request(
    `/users/${(login.body as { data: { user: { id: string } } }).data.user.id}`,
    { method: "DELETE" },
    superToken,
  );
  if (selfDeleteReal.status === 400) {
    ok("DELETE /users/:id blocks deleting your own account (400)");
  } else {
    fail("self-delete guard", selfDeleteReal);
  }

  const removed = await request(`/users/${userId}`, { method: "DELETE" }, superToken);
  if (removed.status === 200) {
    ok("DELETE /users/:id removes the user");
  } else {
    fail("DELETE /users/:id", removed);
  }

  const missing = await request(`/users/${userId}`, {}, superToken);
  if (missing.status === 404) {
    ok("GET /users/:id returns 404 after delete");
  } else {
    fail("GET deleted user", missing);
  }

  const badId = await request("/users/not-a-uuid", {}, superToken);
  if (badId.status === 400) {
    ok("user routes validate uuid params (400)");
  } else {
    fail("uuid param validation", badId);
  }

  const roles = await request("/roles", {}, superToken);
  if (
    roles.status === 200 &&
    (roles.body as { data: Array<{ name: string; permissions: unknown[] }> }).data.length === 4 &&
    (roles.body as { data: Array<{ permissions: unknown[] }> }).data.every(
      (r) => Array.isArray(r.permissions) && r.permissions.length > 0,
    )
  ) {
    ok("GET /roles returns 4 seeded roles with permissions");
  } else {
    fail("GET /roles", roles);
  }

  const noAuth = await request("/users");
  if (noAuth.status === 401) {
    ok("user routes require authentication (401)");
  } else {
    fail("auth guard", noAuth);
  }

  const viewerList = await request("/users", {}, viewerToken);
  if (viewerList.status === 403) {
    ok("viewer cannot list users (403)");
  } else {
    fail("viewer user list guard", viewerList);
  }

  const viewerCreate = await request(
    "/users",
    { method: "POST", body: JSON.stringify({ name: "Nope", email: "nope@vigilens.io", password: "password123" }) },
    viewerToken,
  );
  if (viewerCreate.status === 403) {
    ok("viewer cannot create users (403)");
  } else {
    fail("viewer create guard", viewerCreate);
  }

  const viewerCameras = await request("/cameras?page=1&limit=5", {}, viewerToken);
  if (viewerCameras.status === 200) {
    ok("viewer can read cameras");
  } else {
    fail("viewer camera read", viewerCameras);
  }

  const viewerModelCreate = await request(
    "/models",
    { method: "POST", body: JSON.stringify({ name: "Nope", version: "1.0.0", detectorKey: "nope_x" }) },
    viewerToken,
  );
  if (viewerModelCreate.status === 403) {
    ok("viewer cannot manage models (403)");
  } else {
    fail("viewer model manage guard", viewerModelCreate);
  }

  const operatorCameras = await request("/cameras?page=1&limit=5", {}, operatorToken);
  if (operatorCameras.status === 200) {
    ok("operator can read cameras");
  } else {
    fail("operator camera read", operatorCameras);
  }

  const operatorModelCreate = await request(
    "/models",
    { method: "POST", body: JSON.stringify({ name: "Nope", version: "1.0.0", detectorKey: "nope_y" }) },
    operatorToken,
  );
  if (operatorModelCreate.status === 403) {
    ok("operator cannot manage models (403)");
  } else {
    fail("operator model manage guard", operatorModelCreate);
  }

  const operatorAnalytics = await request("/analytics/overview", {}, operatorToken);
  if (operatorAnalytics.status === 403) {
    ok("operator cannot view analytics (403)");
  } else {
    fail("operator analytics guard", operatorAnalytics);
  }

  const adminRoles = await request("/roles", {}, adminToken);
  if (adminRoles.status === 200) {
    ok("admin can view roles");
  } else {
    fail("admin roles read", adminRoles);
  }

  const adminRoleEdit = await request(
    "/roles/admin/permissions",
    { method: "PATCH", body: JSON.stringify({ permissionKeys: ["users.read"] }) },
    adminToken,
  );
  if (adminRoleEdit.status === 403) {
    ok("admin cannot edit role permissions (403)");
  } else {
    fail("admin role edit guard", adminRoleEdit);
  }

  const superRoleEditBlocked = await request(
    "/roles/super_admin/permissions",
    { method: "PATCH", body: JSON.stringify({ permissionKeys: ["users.read"] }) },
    superToken,
  );
  if (superRoleEditBlocked.status === 400) {
    ok("super admin role permissions cannot be edited (400)");
  } else {
    fail("super admin role protection", superRoleEditBlocked);
  }

  const viewerRole = await request("/roles", {}, superToken);
  const viewerRoleData = (viewerRole.body as { data: Array<{ name: string; permissions: Array<{ key: string }> }> }).data.find(
    (r) => r.name === "viewer",
  );
  if (!viewerRoleData) {
    fail("viewer role lookup", viewerRole);
    return;
  }
  const originalViewerKeys = viewerRoleData.permissions.map((p) => p.key);

  const viewerRoleEdit = await request(
    "/roles/viewer/permissions",
    { method: "PATCH", body: JSON.stringify({ permissionKeys: ["cameras.read"] }) },
    superToken,
  );
  if (viewerRoleEdit.status === 200) {
    ok("PATCH /roles/:name/permissions updates the viewer role");
  } else {
    fail("PATCH /roles/:name/permissions", viewerRoleEdit);
  }

  const viewerReportsAfterEdit = await request("/reports?page=1&limit=5", {}, viewerToken);
  if (viewerReportsAfterEdit.status === 403) {
    ok("permission removal takes effect (viewer loses reports access immediately)");
  } else {
    fail("permission change propagation", viewerReportsAfterEdit);
  }

  const badPermissionKey = await request(
    "/roles/viewer/permissions",
    { method: "PATCH", body: JSON.stringify({ permissionKeys: ["not.a.real.key"] }) },
    superToken,
  );
  if (badPermissionKey.status === 400) {
    ok("role permission updates reject unknown keys (400)");
  } else {
    fail("role permission key validation", badPermissionKey);
  }

  await request(
    "/roles/viewer/permissions",
    { method: "PATCH", body: JSON.stringify({ permissionKeys: originalViewerKeys }) },
    superToken,
  );
  ok("viewer role permissions restored");
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
