import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT = 4600 + (process.pid % 500);
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

interface MarketplaceItem {
  key: string;
  installed: boolean;
  id: string | null;
}

async function run() {
  if (!(await isPortFree(TEST_PORT))) {
    fail("test port reservation", `port ${TEST_PORT} already in use`);
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for detector API tests...`);
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

  const marketplace = await request("/detectors/marketplace", {}, token);
  if (marketplace.status !== 200) {
    fail("GET /detectors/marketplace", marketplace);
    return;
  }
  const items = (marketplace.body as { data: MarketplaceItem[] }).data;
  if (items.length === 14) {
    ok("marketplace exposes 14 detector definitions");
  } else {
    fail("marketplace definition count", items.length);
  }
  const installedCount = items.filter((i) => i.installed).length;
  const availableCount = items.filter((i) => !i.installed).length;
  if (installedCount === 8 && availableCount === 6) {
    ok("marketplace splits into 8 installed / 6 available");
  } else {
    fail("marketplace installed/available split", { installedCount, availableCount });
  }

  // Clean up any leaked test detector from previous runs.
  const leaked = items.find((i) => i.key === "weapon" && i.installed);
  if (leaked && leaked.id) {
    await request(`/detectors/${leaked.id}`, { method: "DELETE" }, token);
  }

  const categories = await request("/detectors/categories", {}, token);
  const catData = (categories.body as { data: string[] }).data ?? [];
  if (categories.status === 200 && catData.includes("Security") && catData.includes("Safety")) {
    ok("GET /detectors/categories returns category list");
  } else {
    fail("GET /detectors/categories", catData);
  }

  const list = await request("/detectors?page=1&limit=100", {}, token);
  if (list.status === 200 && (list.body as { total: number }).total === 8) {
    ok("GET /detectors lists the 8 installed detectors");
  } else {
    fail("GET /detectors", list);
  }

  const byStatus = await request("/detectors?status=running", {}, token);
  if (byStatus.status === 200 && (byStatus.body as { total: number }).total >= 1) {
    ok("GET /detectors filters by running status");
  } else {
    fail("GET /detectors status filter", byStatus);
  }

  const installed = await request(
    "/detectors",
    {
      method: "POST",
      body: JSON.stringify({ detectorKey: "weapon" }),
    },
    token,
  );
  if (installed.status !== 201) {
    fail("POST /detectors install", installed);
    return;
  }
  const installedBody = installed.body as { data: { id: string; name: string; status: string } };
  const detectorId = installedBody.data.id;
  if (installedBody.data.name === "Weapon Detection" && installedBody.data.status === "stopped") {
    ok("POST /detectors installs an available detector as stopped");
  } else {
    fail("POST /detectors payload", installedBody);
  }

  const dupInstall = await request(
    "/detectors",
    { method: "POST", body: JSON.stringify({ detectorKey: "weapon" }) },
    token,
  );
  if (dupInstall.status === 409) {
    ok("POST /detectors rejects duplicate install (409)");
  } else {
    fail("POST /detectors duplicate guard", dupInstall);
  }

  const badInstall = await request(
    "/detectors",
    { method: "POST", body: JSON.stringify({ detectorKey: "does_not_exist" }) },
    token,
  );
  if (badInstall.status === 400) {
    ok("POST /detectors rejects unknown key (400)");
  } else {
    fail("POST /detectors unknown key", badInstall);
  }

  const detail = await request(`/detectors/${detectorId}`, {}, token);
  if (
    detail.status === 200 &&
    (detail.body as { data: { settings: object | null; cameras: unknown[] } }).data
      .settings !== null
  ) {
    ok("GET /detectors/:id returns settings");
  } else {
    fail("GET /detectors/:id", detail);
  }

  const settings = await request(
    `/detectors/${detectorId}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({
        confidenceThreshold: 72,
        alertSeverity: "critical",
        detectionIntervalMs: 2500,
        preferredProcessor: "gpu",
      }),
    },
    token,
  );
  const settingsBody = settings.body as {
    data: {
      confidenceThreshold: number;
      settings: { alertSeverity: string; detectionIntervalMs: number; preferredProcessor: string };
    };
  };
  if (
    settings.status === 200 &&
    settingsBody.data.confidenceThreshold === 72 &&
    settingsBody.data.settings.alertSeverity === "critical" &&
    settingsBody.data.settings.detectionIntervalMs === 2500 &&
    settingsBody.data.settings.preferredProcessor === "gpu"
  ) {
    ok("PATCH /detectors/:id/settings updates all configuration");
  } else {
    fail("PATCH /detectors/:id/settings", settingsBody);
  }

  const badSettings = await request(
    `/detectors/${detectorId}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({ confidenceThreshold: 120, detectionIntervalMs: 10 }),
    },
    token,
  );
  if (badSettings.status === 400) {
    ok("PATCH settings validates ranges (400)");
  } else {
    fail("PATCH settings validation", badSettings);
  }

  const cameras = await request(
    `/detectors/${detectorId}/cameras`,
    {
      method: "PUT",
      body: JSON.stringify({ cameraIds: ["demo-camera-1", "demo-camera-2"] }),
    },
    token,
  );
  const camerasBody = cameras.body as { data: { cameraCount: number; cameras: unknown[] } };
  if (cameras.status === 200 && camerasBody.data.cameraCount === 2) {
    ok("PUT /detectors/:id/cameras assigns two cameras");
  } else {
    fail("PUT /detectors/:id/cameras", camerasBody);
  }

  const badCameras = await request(
    `/detectors/${detectorId}/cameras`,
    {
      method: "PUT",
      body: JSON.stringify({ cameraIds: ["demo-camera-1", "not-a-real-camera"] }),
    },
    token,
  );
  if (badCameras.status === 400) {
    ok("PUT cameras rejects unknown camera ids (400)");
  } else {
    fail("PUT cameras validation", badCameras);
  }

  const healthStopped = await request(`/detectors/${detectorId}/health`, {}, token);
  const healthStoppedBody = healthStopped.body as { data: { status: string; healthy: boolean } };
  if (healthStopped.status === 200 && healthStoppedBody.data.status === "stopped") {
    ok("GET /detectors/:id/health reports stopped state");
  } else {
    fail("GET /detectors/:id/health (stopped)", healthStoppedBody);
  }

  const restartBlocked = await request(`/detectors/${detectorId}/disable`, { method: "PATCH" }, token);
  if (
    restartBlocked.status === 200 &&
    (restartBlocked.body as { data: { status: string } }).data.status === "stopped"
  ) {
    ok("PATCH /detectors/:id/disable stops a disabled-installed detector");
  } else {
    fail("PATCH /detectors/:id/disable (pre-restart)", restartBlocked);
  }

  const restartGuard = await request(`/detectors/${detectorId}/restart`, { method: "POST" }, token);
  if (restartGuard.status === 400) {
    ok("POST /detectors/:id/restart blocks disabled detectors (400)");
  } else {
    fail("POST /detectors/:id/restart guard", restartGuard);
  }

  const enabled = await request(`/detectors/${detectorId}/enable`, { method: "PATCH" }, token);
  if (
    enabled.status === 200 &&
    (enabled.body as { data: { status: string } }).data.status === "stopped"
  ) {
    ok("PATCH /detectors/:id/enable keeps stopped until loaded");
  } else {
    fail("PATCH /detectors/:id/enable", enabled);
  }

  const restart = await request(`/detectors/${detectorId}/restart`, { method: "POST" }, token);
  const restartBody = restart.body as { data: { status: string; lastRestartAt: string | null } };
  if (restart.status === 200 && restartBody.data.lastRestartAt) {
    ok("POST /detectors/:id/restart initiates a restart cycle");
  } else {
    fail("POST /detectors/:id/restart", restartBody);
  }

  await sleep(1800);
  const afterRestart = await request(`/detectors/${detectorId}`, {}, token);
  const afterRestartBody = afterRestart.body as { data: { status: string } };
  if (afterRestart.status === 200 && afterRestartBody.data.status === "running") {
    ok("detector reaches running status after restart");
  } else {
    fail("detector restart finalization", afterRestartBody);
  }

  const healthRunning = await request(`/detectors/${detectorId}/health`, {}, token);
  const healthRunningBody = healthRunning.body as {
    data: { status: string; healthy: boolean; latencyMs: number; engine: { status: string; healthy: boolean } };
  };
  // The DB layer reports the detector as running; the engine health layer is
  // honest about the missing trained model (weapon has no AI backend yet).
  if (
    healthRunning.status === 200 &&
    healthRunningBody.data.status === "running" &&
    healthRunningBody.data.latencyMs >= 1 &&
    healthRunningBody.data.engine?.status === "unconfigured" &&
    healthRunningBody.data.engine?.healthy === false
  ) {
    ok("GET /detectors/:id/health reports running state with honest engine status");
  } else {
    fail("GET /detectors/:id/health (running)", healthRunningBody);
  }

  const disabled = await request(`/detectors/${detectorId}/disable`, { method: "PATCH" }, token);
  if (
    disabled.status === 200 &&
    (disabled.body as { data: { status: string } }).data.status === "stopped"
  ) {
    ok("PATCH /detectors/:id/disable stops the detector");
  } else {
    fail("PATCH /detectors/:id/disable", disabled);
  }

  const marketCheck = await request("/detectors/marketplace", {}, token);
  const marketItems = (marketCheck.body as { data: MarketplaceItem[] }).data;
  const weapon = marketItems.find((i) => i.key === "weapon");
  if (weapon && weapon.installed) {
    ok("marketplace reflects newly installed detector");
  } else {
    fail("marketplace installed flag", weapon);
  }

  const removed = await request(`/detectors/${detectorId}`, { method: "DELETE" }, token);
  if (removed.status === 200) {
    ok("DELETE /detectors/:id uninstalls the detector");
  } else {
    fail("DELETE /detectors/:id", removed);
  }

  const missing = await request(`/detectors/${detectorId}`, {}, token);
  if (missing.status === 404) {
    ok("GET /detectors/:id returns 404 after uninstall");
  } else {
    fail("GET uninstalled detector", missing);
  }

  const badId = await request("/detectors/not-a-uuid", {}, token);
  if (badId.status === 400) {
    ok("detector routes validate uuid params (400)");
  } else {
    fail("uuid param validation", badId);
  }

  const noAuth = await request("/detectors/marketplace");
  if (noAuth.status === 401) {
    ok("detector routes require authentication (401)");
  } else {
    fail("auth guard", noAuth);
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
