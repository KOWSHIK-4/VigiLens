import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 4931;
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
  let cameraId: string | null = null;

  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for alert API tests...`);
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
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (login.status !== 200 || !login.body || typeof login.body !== "object") {
    fail("admin login", login);
    return;
  }
  const token = (login.body as { data: { token: string } }).data.token;
  ok("admin login returns token");

  // Fixture: one camera, two detections, two alerts (one critical unread,
  // one warning read).
  const camera = await prisma.camera.create({
    data: { name: "alert-api-test-cam", url: "/dev/null", cameraType: "usb" },
  });
  cameraId = camera.id;
  const detA = await prisma.detection.create({
    data: { cameraId: camera.id, label: "person", confidence: 0.91, imageUrl: "test-a.jpg" },
  });
  const detB = await prisma.detection.create({
    data: { cameraId: camera.id, label: "vehicle", confidence: 0.72, imageUrl: "test-b.jpg" },
  });
  const alertCritical = await prisma.alert.create({
    data: { detectionId: detA.id, severity: "critical", title: "Critical test alert", message: "critical path" },
  });
  const alertWarning = await prisma.alert.create({
    data: { detectionId: detB.id, severity: "warning", title: "Warning test alert", message: "warning path", isRead: true },
  });

  // --- Query validation ---
  let res = await request("/alerts?severity=bogus", {}, token);
  if (res.status === 400) ok("severity=bogus is rejected with 400");
  else fail("severity validation", res);

  res = await request("/alerts?page=0", {}, token);
  if (res.status === 400) ok("page=0 is rejected with 400");
  else fail("page validation", res);

  res = await request("/alerts?limit=1000", {}, token);
  if (res.status === 400) ok("limit=1000 is rejected with 400");
  else fail("limit validation", res);

  res = await request("/alerts?isRead=maybe", {}, token);
  if (res.status === 400) ok("isRead=maybe is rejected with 400");
  else fail("isRead validation", res);

  // --- Valid queries still work end to end ---
  res = await request("/alerts?page=1&limit=10", {}, token);
  const listBody = res.body as
    | { data?: Array<{ id: string; severity: string; isRead: boolean }>; total?: number }
    | null;
  if (
    res.status === 200 &&
    listBody?.data?.some((a) => a.id === alertCritical.id) &&
    listBody.data.some((a) => a.id === alertWarning.id)
  ) {
    ok("GET /alerts returns the seeded alerts");
  } else {
    fail("GET /alerts", res);
  }

  res = await request("/alerts?severity=critical", {}, token);
  const critList = res.body as { data?: Array<{ id: string }> } | null;
  if (
    res.status === 200 &&
    critList?.data?.some((a) => a.id === alertCritical.id) &&
    !critList.data.some((a) => a.id === alertWarning.id)
  ) {
    ok("severity=critical filters to the critical alert only");
  } else {
    fail("severity filter", res);
  }

  res = await request("/alerts?isRead=false", {}, token);
  const unreadList = res.body as { data?: Array<{ id: string }> } | null;
  if (
    res.status === 200 &&
    unreadList?.data?.some((a) => a.id === alertCritical.id) &&
    !unreadList.data.some((a) => a.id === alertWarning.id)
  ) {
    ok("isRead=false filters to the unread alert only");
  } else {
    fail("isRead filter", res);
  }

  // --- Param validation and 404 semantics ---
  res = await request(`/alerts/not-a-uuid/read`, { method: "PATCH" }, token);
  if (res.status === 400) ok("PATCH /alerts/:id/read rejects a non-uuid id with 400");
  else fail("param uuid validation", res);

  const randomUuid = "00000000-0000-4000-8000-000000000000";
  res = await request(`/alerts/${randomUuid}/read`, { method: "PATCH" }, token);
  if (res.status === 404) ok("marking an unknown alert as read returns 404");
  else fail("markAsRead 404", res);

  res = await request(`/alerts/${randomUuid}`, { method: "DELETE" }, token);
  if (res.status === 404) ok("deleting an unknown alert returns 404");
  else fail("delete 404", res);

  // --- Happy paths for the mutations ---
  res = await request(`/alerts/${alertCritical.id}/read`, { method: "PATCH" }, token);
  if (res.status === 200) ok("marking the seeded alert as read succeeds");
  else fail("markAsRead happy path", res);

  res = await request(`/alerts/${alertWarning.id}`, { method: "DELETE" }, token);
  if (res.status === 200) ok("deleting the seeded alert succeeds");
  else fail("delete happy path", res);

  console.log(`\nAlert API tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  // Cleanup happens before disconnect; alert rows cascade via detection.
  await prisma.alert.deleteMany({ where: { id: { in: [alertCritical.id, alertWarning.id] } } }).catch(() => undefined);
  await prisma.detection.deleteMany({ where: { id: { in: [detA.id, detB.id] } } }).catch(() => undefined);
  await prisma.camera.deleteMany({ where: { id: cameraId } }).catch(() => undefined);
}

run().finally(() => {
  if (server) killProcessTree(server);
  prisma.$disconnect().catch(() => undefined);
});
