import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import http from "node:http";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma";

const TEST_PORT_BASE = 5151;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

const RUN_TAG = `${process.pid}`;
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || "dev-internal-key-change-in-production";

let server: ChildProcess | null = null;
let fixture: OrgBFixture | null = null;
let passed = 0;
let failed = 0;

interface OrgBFixture {
  orgId: string;
  userId: string;
  email: string;
  cameraId: string;
}

function ok(name: string, detail?: unknown) {
  passed += 1;
  console.log(`  PASS  ${name}${detail !== undefined ? ` - ${JSON.stringify(detail)}` : ""}`);
}

function fail(name: string, detail?: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  if (detail !== undefined) console.error(`        ${JSON.stringify(detail)}`);
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

interface SseConnection {
  buffer: string;
  close: () => void;
  done: Promise<void>;
}

function openSse(pathname: string): Promise<SseConnection> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: "localhost", port: TEST_PORT, path: pathname },
      (res) => {
        const buffer: string[] = [];
        res.on("data", (chunk: Buffer) => buffer.push(chunk.toString()));
        const sse: SseConnection = {
          get buffer() {
            return buffer.join("");
          },
          close: () => req.destroy(),
          done: new Promise((resolveDone) => res.on("end", resolveDone)),
        };
        resolve(sse);
      },
    );
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("sse connect timeout")));
  });
}

function parseEvents(sse: SseConnection): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of sse.buffer.split("\n")) {
    if (line.startsWith("data: ")) {
      try {
        events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
      } catch {
        // partial or non-JSON frame
      }
    }
  }
  return events;
}

async function waitForEvent(
  sse: SseConnection,
  type: string,
  timeoutMs = 6000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = parseEvents(sse).find((e) => e.type === type);
    if (found) return found;
    await sleep(100);
  }
  return null;
}

/** Creates a second tenant (org + admin + camera) directly in the database,
 * mirroring how the tenant-isolation suite bootstraps tenant B. */
async function seedOrgB(): Promise<OrgBFixture> {
  const orgId = `00000000-0000-4000-8000-${RUN_TAG.padStart(12, "0").slice(-12)}`;
  const email = `orgb-regress-${RUN_TAG}@vigilens.io`;

  const org = await prisma.organization.create({
    data: { id: orgId, name: `Tenant B (${RUN_TAG})`, slug: `tenant-b-regress-${RUN_TAG}` },
  });

  const password = await bcrypt.hash("admin123", 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Tenant B Admin",
      password,
      role: "super_admin",
      status: "active",
      organizationId: org.id,
    },
  });

  const camera = await prisma.camera.create({
    data: {
      name: `orgb-camera-${RUN_TAG}`,
      url: `rtsp://tenant-b/stream-${RUN_TAG}`,
      organizationId: org.id,
    },
  });

  return { orgId: org.id, userId: user.id, email, cameraId: camera.id };
}

async function cleanupOrgB(orgId: string) {
  try {
    await prisma.systemSetting.deleteMany({ where: { organizationId: orgId } });
  } catch {
    // already gone
  }
  try {
    await prisma.role.deleteMany({ where: { organizationId: orgId } });
  } catch {
    // already gone
  }
  try {
    await prisma.alert.deleteMany({ where: { organizationId: orgId } });
  } catch {
    // already gone
  }
  try {
    await prisma.detection.deleteMany({ where: { organizationId: orgId } });
  } catch {
    // already gone
  }
  try {
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
  } catch {
    // already gone
  }
  try {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => null);
  } catch {
    // already gone
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

  try {
    fixture = await seedOrgB();
  } catch (err) {
    fail("seed tenant B", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for isolation regression tests...`);
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

  const login = async (email: string) => {
    const res = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "admin123" }),
    });
    if (res.status !== 200) {
      fail(`login ${email}`, res);
      return null;
    }
    return (res.body as { data: { token: string } }).data.token;
  };

  const tokenA = await login("super@vigilens.io");
  const tokenB = await login(fixture.email);
  if (!tokenA || !tokenB) return;
  ok("tenant A and tenant B logins");

  const meA = await request("/auth/me", {}, tokenA);
  const userAId = (meA.body as { data?: { id?: string } })?.data?.id;
  if (typeof userAId !== "string" || userAId.length === 0) {
    fail("tenant A user id resolution", meA.body);
    return;
  }
  ok("tenant A user id resolved from /auth/me");

  // ---------------------------------------------------------------------
  // 1. Real-time fan-out isolation: an org-B alert must never reach an
  // org-A subscriber, and must reach org-B subscribers.
  // ---------------------------------------------------------------------
  const ticketARes = await request("/auth/realtime-ticket", { method: "POST" }, tokenA);
  const ticketA = (ticketARes.body as { data?: { ticket?: string } })?.data?.ticket;
  const ticketBRes = await request("/auth/realtime-ticket", { method: "POST" }, tokenB);
  const ticketB = (ticketBRes.body as { data?: { ticket?: string } })?.data?.ticket;
  if (!ticketA || !ticketB) {
    fail("realtime ticket issuance", { ticketARes, ticketBRes });
    return;
  }
  ok("realtime tickets issued for both tenants");

  const sseA = await openSse(`/api/realtime/events?ticket=${ticketA}`);
  await sleep(200);
  const sseB = await openSse(`/api/realtime/events?ticket=${ticketB}`);
  await sleep(300);
  if (sseA.buffer.includes(":connected") && sseB.buffer.includes(":connected")) {
    ok("both tenant SSE streams opened");
  } else {
    fail("SSE stream open", { a: sseA.buffer, b: sseB.buffer });
  }

  const ingest = await request("/detections/internal", {
    method: "POST",
    headers: { "X-Internal-Key": INTERNAL_KEY },
    body: JSON.stringify({
      camera_id: fixture.cameraId,
      label: `cross-tenant-intruder-${RUN_TAG}`,
      confidence: 0.97,
      image_url: "",
      detector_key: "person",
      class_name: "person",
      track_id: "901",
    }),
  });
  if (ingest.status === 201) ok("ingested a critical detection for tenant B camera");
  else fail("tenant B internal ingest", ingest);

  const eventB = await waitForEvent(sseB, "alert");
  if (eventB) ok("tenant B subscriber received the org-B alert event");
  else fail("tenant B alert event", sseB.buffer);

  await sleep(400);
  const eventsA = parseEvents(sseA);
  const uniqueLabel = `cross-tenant-intruder-${RUN_TAG}`;
  const leaked = eventsA.some(
    (e) => e.type === "alert" && String((e.data as Record<string, unknown>)?.title ?? "").includes(uniqueLabel),
  );
  if (!leaked) ok("tenant A subscriber received no org-B alert event (fan-out isolated)");
  else fail("tenant A fan-out leak", eventsA);

  sseA.close();
  sseB.close();
  await sleep(300);

  // ---------------------------------------------------------------------
  // 2. Subscriber registry isolation: the /realtime/subscribers snapshot and
  // its count are scoped to the caller's organization. A tenant-B admin must
  // not enumerate org-A subscriptions, while a tenant-A admin sees its own.
  // ---------------------------------------------------------------------
  const ticketA2Res = await request("/auth/realtime-ticket", { method: "POST" }, tokenA);
  const ticketA2 = (ticketA2Res.body as { data?: { ticket?: string } })?.data?.ticket;
  let sseA2: SseConnection | null = null;
  if (ticketA2) {
    sseA2 = await openSse(`/api/realtime/events?ticket=${ticketA2}`);
    await sleep(300);
    ok("tenant A second SSE stream open for registry checks");
  } else {
    fail("realtime ticket issuance (second)", ticketA2Res);
  }

  const subsB = (await request("/realtime/subscribers", {}, tokenB)).body as {
    data?: { count: number; subscribers: Array<{ userId: string; organizationId?: string }> };
  };
  const bVisible = subsB?.data?.subscribers ?? [];
  const bCount = subsB?.data?.count ?? -1;
  const leakedA = bVisible.some((s) => s.userId === userAId);
  if (!leakedA && bCount === 0) {
    ok("tenant B admin sees no org-A subscriber (snapshot and count org-scoped)");
  } else {
    fail("tenant B subscriber snapshot leak", { bCount, bVisible });
  }

  const subsA = (await request("/realtime/subscribers", {}, tokenA)).body as {
    data?: { count: number; subscribers: Array<{ userId: string }> };
  };
  const aVisible = subsA?.data?.subscribers ?? [];
  if (subsA?.data?.count === 1 && aVisible.length === 1 && aVisible[0].userId === userAId) {
    ok("tenant A admin sees its own single subscriber");
  } else {
    fail("tenant A subscriber snapshot", subsA?.data);
  }

  if (sseA2) sseA2.close();
  await sleep(300);

  // ---------------------------------------------------------------------
  // 3. Settings isolation: a non-security setting written by tenant B stays
  // within tenant B's scope and never changes tenant A's value.
  // ---------------------------------------------------------------------
  const valueOf = (settingsRes: unknown, key: string): string | number | boolean | null => {
    const rows = (settingsRes as { data?: Array<{ key: string; value: string | number | boolean }> })?.data;
    return rows?.find((r) => r.key === key)?.value ?? null;
  };

  const beforeB = await request("/settings/notifications", {}, tokenB);
  const beforeA = await request("/settings/notifications", {}, tokenA);
  const defB = valueOf(beforeB.body, "email_alerts_enabled");
  const defA = valueOf(beforeA.body, "email_alerts_enabled");
  if (defB === true && defA === true) ok("email_alerts_enabled defaults true for both tenants");
  else fail("settings defaults", { defB, defA });

  const patchB = await request("/settings/notifications", {
    method: "PATCH",
    body: JSON.stringify({ email_alerts_enabled: false }),
  }, tokenB);
  if (patchB.status === 200) ok("tenant B updated its own email_alerts_enabled=false");
  else fail("tenant B settings update", patchB);

  const afterABody = await request("/settings/notifications", {}, tokenA);
  const afterA = valueOf(afterABody.body, "email_alerts_enabled");
  if (afterA === true) ok("tenant A setting value unchanged after tenant B update");
  else fail("tenant A setting changed by tenant B", { afterA });

  const afterBBody = await request("/settings/notifications", {}, tokenB);
  const afterB = valueOf(afterBBody.body, "email_alerts_enabled");
  if (afterB === false) ok("tenant B reads its own updated value");
  else fail("tenant B setting readback", { afterB });

  await request("/settings/notifications", {
    method: "PATCH",
    body: JSON.stringify({ email_alerts_enabled: true }),
  }, tokenB);

  // ---------------------------------------------------------------------
  // 4. RBAC cross-tenant guards: users and roles are resolvable only within
  // the caller's organization; foreign role names fail closed.
  // ---------------------------------------------------------------------
  const usersB = (await request("/users?page=1&limit=100", {}, tokenB)).body as {
    data?: Array<{ id: string }>;
  };
  const bIds = usersB?.data?.map((u) => u.id) ?? [];
  if (bIds.length === 1 && bIds[0] === fixture.userId) {
    ok("tenant B user list contains only its own users");
  } else {
    fail("tenant B user list", { bIds });
  }

  const lockB = await request(`/users/${userAId}/lock`, { method: "POST" }, tokenB);
  if (lockB.status === 404) ok("tenant B cannot lock a tenant A user (404)");
  else fail("tenant B lock of tenant A user", lockB);

  const fetchB = await request(`/users/${userAId}`, {}, tokenB);
  if (fetchB.status === 404) ok("tenant B cannot read a tenant A user (404)");
  else fail("tenant B read of tenant A user", fetchB);

  const roleBName = `tenant_b_analyst_${RUN_TAG}`;
  const createRoleB = await request("/roles", {
    method: "POST",
    body: JSON.stringify({ name: roleBName, permissionKeys: ["roles.read"] }),
  }, tokenB);
  if (createRoleB.status === 201) ok("tenant B created its own custom role");
  else fail("tenant B role create", createRoleB);

  const rolesA = (await request("/roles", {}, tokenA)).body as { data?: Array<{ name: string }> };
  const namesA = rolesA?.data?.map((r) => r.name) ?? [];
  if (!namesA.includes(roleBName)) ok("tenant A role list excludes tenant B role");
  else fail("tenant A role list leak", namesA);

  const rolesB = (await request("/roles", {}, tokenB)).body as { data?: Array<{ name: string }> };
  const namesB = rolesB?.data?.map((r) => r.name) ?? [];
  if (namesB.includes(roleBName)) ok("tenant B role list includes its own role");
  else fail("tenant B role list", namesB);

  const assignForeign = await request(`/users/${userAId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role: roleBName }),
  }, tokenA);
  if (assignForeign.status === 400) {
    ok("assigning a foreign tenant's role name to a user fails closed (400)");
  } else {
    fail("cross-tenant role assignment", assignForeign);
  }

  const tokenV = await login("viewer@vigilens.io");
  if (tokenV) {
    const rolesV = await request("/roles", {}, tokenV);
    const permsV = await request("/roles/permissions", {}, tokenV);
    if (rolesV.status === 403 && permsV.status === 403) {
      ok("viewer is denied role list and permission catalog (403)");
    } else {
      fail("viewer roles access", { rolesV: rolesV.status, permsV: permsV.status });
    }
  }

  if (failed > 0) {
    console.log(`\n${failed} isolation regression test(s) FAILED, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${passed} isolation regression tests passed.`);
  }
}

run()
  .catch((err) => {
    console.error("isolation regression test run crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) killProcessTree(server);
    if (fixture) await cleanupOrgB(fixture.orgId);
    await prisma.$disconnect();
  });