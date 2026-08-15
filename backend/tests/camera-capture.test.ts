import { spawn, execSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { prisma } from "../src/config/prisma";
import { cameraService } from "../src/services/camera.service";
import { AiServiceError } from "../src/engine/aiClient";
import { ApiError } from "../src/utils/errors";

const TEST_PORT_BASE = 5681;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}`;

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const createdCameraIds: string[] = [];

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${JSON.stringify(detail)}`);
}

class FakeCaptureClient {
  frame = Buffer.from("fake-jpeg-bytes");
  error: Error | null = null;
  calls: Array<{ source: string; type: string }> = [];

  async captureFrame(source: string, cameraType: string) {
    this.calls.push({ source, type: cameraType });
    if (this.error) throw this.error;
    return this.frame;
  }

  async detectImage() {
    return { success: true, detections: [], count: 0, output_path: "" };
  }

  async isReachable() {
    return true;
  }
}

async function runServiceTests() {
  const snapshotDir = await mkdtemp(path.join(tmpdir(), "vigilens-capture-"));
  const ids: string[] = [];

  const cam = await prisma.camera.create({
    data: { name: "Capture Unit Test", url: "rtsp://unit-stream", cameraType: "rtsp" },
  });
  ids.push(cam.id);

  {
    const client = new FakeCaptureClient();
    const result = await cameraService.captureSnapshot(cam.id, client, snapshotDir);

    if (result.camera.thumbnail === `/api/cameras/${cam.id}/thumbnail`) {
      ok("captureSnapshot sets the snapshot thumbnail url");
    } else {
      fail("thumbnail url", result.camera.thumbnail);
    }
    if (result.camera.status === "online" && result.camera.isHealthy === true) {
      ok("captureSnapshot marks camera online and healthy");
    } else {
      fail("camera state", { status: result.camera.status, isHealthy: result.camera.isHealthy });
    }
    if (result.camera.lastSnapshotAt) {
      ok("captureSnapshot records lastSnapshotAt");
    } else {
      fail("lastSnapshotAt", result.camera.lastSnapshotAt);
    }
    if (result.snapshotUrl === `/api/cameras/${cam.id}/thumbnail` && result.responseTimeMs >= 0) {
      ok("captureSnapshot returns snapshot url and response time");
    } else {
      fail("result shape", { snapshotUrl: result.snapshotUrl, responseTimeMs: result.responseTimeMs });
    }

    const stored = await readFile(path.join(snapshotDir, `${cam.id}.jpg`));
    if (stored.equals(client.frame)) {
      ok("captureSnapshot persists the captured frame to disk");
    } else {
      fail("frame persisted", stored.toString());
    }

    const log = await prisma.cameraHealthLog.findFirst({
      where: { cameraId: cam.id },
      orderBy: { checkedAt: "desc" },
    });
    if (log?.status === "online" && log.message === "Frame captured successfully") {
      ok("captureSnapshot records an online health log");
    } else {
      fail("health log", log);
    }

    const fetched = await cameraService.getSnapshot(cam.id, snapshotDir);
    if (fetched && fetched.equals(client.frame)) {
      ok("getSnapshot returns the stored frame");
    } else {
      fail("getSnapshot", fetched ? "wrong bytes" : "no file");
    }
  }

  {
    const client = new FakeCaptureClient();
    client.error = new AiServiceError("unreachable", "AI service is unreachable", null);
    let thrown: unknown = null;
    try {
      await cameraService.captureSnapshot(cam.id, client, snapshotDir);
    } catch (err) {
      thrown = err;
    }

    if (thrown instanceof ApiError && thrown.statusCode === 502 && thrown.code === "AI_SERVICE_UNREACHABLE") {
      ok("capture failure maps to 502 AI_SERVICE_UNREACHABLE");
    } else {
      fail("error mapping", thrown);
    }

    const after = await prisma.camera.findUnique({ where: { id: cam.id } });
    if (after?.status === "error" && after.isHealthy === false) {
      ok("failed capture marks camera error and unhealthy");
    } else {
      fail("failed camera state", { status: after?.status, isHealthy: after?.isHealthy });
    }

    const log = await prisma.cameraHealthLog.findFirst({
      where: { cameraId: cam.id },
      orderBy: { checkedAt: "desc" },
    });
    if (log?.status === "error" && log.message === "AI service is unreachable") {
      ok("failed capture records an error health log");
    } else {
      fail("error health log", log);
    }
  }

  {
    let thrown: unknown = null;
    try {
      await cameraService.captureSnapshot("00000000-0000-4000-8000-000000000000", new FakeCaptureClient(), snapshotDir);
    } catch (err) {
      thrown = err;
    }
    if (thrown instanceof ApiError && thrown.statusCode === 404) {
      ok("captureSnapshot throws 404 for unknown camera");
    } else {
      fail("404 mapping", thrown);
    }
  }

  {
    const missing = await cameraService.getSnapshot("00000000-0000-4000-8000-000000000000", snapshotDir);
    if (missing === null) {
      ok("getSnapshot returns null when no snapshot exists");
    } else {
      fail("missing snapshot", missing);
    }
  }

  await prisma.camera.deleteMany({ where: { id: { in: ids } } });
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
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
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
  return { status: res.status, headers: res.headers, body };
}

async function runApiTests() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  server = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test", MONITOR_ENABLED: "false" },
    },
  );

  if (!(await waitForServer())) {
    fail("server startup", `backend did not become healthy on port ${TEST_PORT}`);
    return;
  }
  ok("backend started");

  async function login(email: string, password = "admin123") {
    const res = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    return res as unknown as { status: number; body: { data: { token: string } } };
  }

  const superLogin = await login("super@vigilens.io");
  if (superLogin.status !== 200) {
    fail("super login", superLogin);
    return;
  }
  const superToken = superLogin.body.data.token;

  const created = await request(
    "/api/cameras",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Capture API Test Cam",
        url: "rtsp://capture-api-stream",
        cameraType: "rtsp",
      }),
    },
    superToken,
  );
  const createdBody = created.body as { data?: { id?: string; name?: string } } | null;
  if (created.status === 201 && createdBody?.data?.id) {
    ok("camera created for capture tests");
    createdCameraIds.push(createdBody.data.id as string);
  } else {
    fail("camera creation", created);
    return;
  }
  const cameraId = createdBody!.data!.id as string;

  const unauthCapture = await request(`/api/cameras/${cameraId}/capture`, { method: "POST", body: "{}" });
  if (unauthCapture.status === 401) {
    ok("capture requires authentication (401)");
  } else {
    fail("unauth capture", unauthCapture);
  }

  const noSnapshot = await request(`/api/cameras/${cameraId}/thumbnail`, {}, superToken);
  if (noSnapshot.status === 404) {
    ok("thumbnail returns 404 before any capture");
  } else {
    fail("pre-capture thumbnail", noSnapshot);
  }

  const failedCapture = await request(`/api/cameras/${cameraId}/capture`, { method: "POST", body: "{}" }, superToken);
  const fc = failedCapture.body as { code?: string } | null;
  if (failedCapture.status === 502 && fc?.code === "AI_SERVICE_UNREACHABLE") {
    ok("capture with unreachable AI service returns 502 AI_SERVICE_UNREACHABLE");
  } else {
    fail("failed capture", failedCapture);
  }

  const afterCapture = await request(`/api/cameras/${cameraId}`, {}, superToken);
  const ac = afterCapture.body as { data?: { status?: string; isHealthy?: boolean } } | null;
  if (afterCapture.status === 200 && ac?.data?.status === "error" && ac.data.isHealthy === false) {
    ok("failed capture persists error state on the camera");
  } else {
    fail("failed capture state", ac);
  }

  const viewerLogin = await login("viewer@vigilens.io");
  if (viewerLogin.status !== 200) {
    fail("viewer login", viewerLogin);
    return;
  }
  const viewerToken = viewerLogin.body.data.token;

  const viewerCapture = await request(`/api/cameras/${cameraId}/capture`, { method: "POST", body: "{}" }, viewerToken);
  if (viewerCapture.status === 403) {
    ok("viewer without cameras.control is denied capture (403)");
  } else {
    fail("viewer capture RBAC", viewerCapture);
  }

  const viewerThumbnail = await request(`/api/cameras/${cameraId}/thumbnail`, {}, viewerToken);
  if (viewerThumbnail.status === 404) {
    ok("viewer with cameras.read can request the thumbnail endpoint");
  } else {
    fail("viewer thumbnail", viewerThumbnail);
  }

  const audit = await request(`/api/audit-logs?action=camera_captured`, {}, superToken);
  const au = audit.body as { data?: unknown[] } | null;
  if (audit.status === 200 && Array.isArray(au?.data)) {
    ok("audit log query accepts the camera_captured action filter");
  } else {
    fail("audit filter", audit);
  }
}

async function cleanup() {
  if (createdCameraIds.length > 0) {
    await prisma.camera.deleteMany({ where: { id: { in: createdCameraIds } } }).catch(() => undefined);
  }
  await prisma.$disconnect().catch(() => undefined);
}

runServiceTests()
  .then(() => runApiTests())
  .then(cleanup)
  .then(() => {
    if (server) killProcessTree(server);
    console.log(`\nCamera capture tests: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    if (server) killProcessTree(server);
    console.error(err);
    process.exit(1);
  });
