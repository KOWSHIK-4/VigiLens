import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 4610;
const TEST_PORT_RANGE = 390;
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

interface DetectorRow {
  id: string;
  name: string;
  detectorKey: string;
  runtimeStatus: string;
  type: string;
  supportedInput: string[];
  enabled: boolean;
  settings: { alertCooldownMs: number | null } | null;
  status: string;
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for detector management API tests...`);
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

  const list = await request("/detectors?page=1&limit=100", {}, adminToken);
  const rows = (list.body as { data: DetectorRow[] }).data ?? [];
  if (list.status === 200 && rows.length >= 8) {
    ok("GET /detectors lists installed detectors");
  } else {
    fail("GET /detectors", list);
  }

  const withRuntime = rows.find((r) => r.detectorKey === "person");
  if (
    withRuntime &&
    withRuntime.runtimeStatus &&
    withRuntime.type === "object_detection" &&
    Array.isArray(withRuntime.supportedInput) &&
    withRuntime.supportedInput.length > 0
  ) {
    ok("detector rows expose lifecycle status, type and supported inputs");
  } else {
    fail("detector row lifecycle fields", withRuntime);
  }

  const withCooldown = rows.find((r) => r.detectorKey === "vehicle");
  if (withCooldown && typeof withCooldown.settings?.alertCooldownMs === "number") {
    ok("detector rows expose per-detector alert cooldown");
  } else {
    fail("detector row alert cooldown", withCooldown);
  }

  // --- PATCH /detectors/:id (generic update) ---

  const target = rows.find((r) => r.detectorKey === "fire") ?? rows[0];
  const patched = await request(
    `/detectors/${target.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({ name: "Fire Detection PRO", version: "2.4.0" }),
    },
    adminToken,
  );
  if (
    patched.status === 200 &&
    (patched.body as { data: DetectorRow }).data.name === "Fire Detection PRO" &&
    (patched.body as { data: DetectorRow }).data.version === "2.4.0"
  ) {
    ok("PATCH /detectors/:id updates name and version");
  } else {
    fail("PATCH /detectors/:id", patched);
  }

  const emptyPatch = await request(
    `/detectors/${target.id}`,
    { method: "PATCH", body: JSON.stringify({}) },
    adminToken,
  );
  if (emptyPatch.status === 400) {
    ok("PATCH /detectors/:id rejects empty body (400)");
  } else {
    fail("PATCH /detectors/:id empty body", emptyPatch);
  }

  const badPatch = await request(
    `/detectors/${target.id}`,
    { method: "PATCH", body: JSON.stringify({ enabled: "yes" }) },
    adminToken,
  );
  if (badPatch.status === 400) {
    ok("PATCH /detectors/:id rejects non-boolean enabled (400)");
  } else {
    fail("PATCH /detectors/:id bad enabled", badPatch);
  }

  // Restore the original name so later runs are deterministic.
  await request(
    `/detectors/${target.id}`,
    { method: "PATCH", body: JSON.stringify({ name: target.name, version: target.version }) },
    adminToken,
  );

  // --- List filters (lifecycle status, type, enabled) ---

  const disabledList = await request("/detectors?status=disabled", {}, adminToken);
  if (
    disabledList.status === 200 &&
    (disabledList.body as { data: DetectorRow[] }).data.every((r) => r.runtimeStatus === "disabled" || r.enabled === false)
  ) {
    ok("GET /detectors filters by lifecycle status (disabled)");
  } else {
    fail("GET /detectors lifecycle status filter", disabledList);
  }

  const typeList = await request("/detectors?type=classification", {}, adminToken);
  if (
    typeList.status === 200 &&
    (typeList.body as { data: DetectorRow[] }).data.length >= 1 &&
    (typeList.body as { data: DetectorRow[] }).data.every((r) => r.type === "classification")
  ) {
    ok("GET /detectors filters by type (classification)");
  } else {
    fail("GET /detectors type filter", typeList);
  }

  const enabledList = await request("/detectors?enabled=true", {}, adminToken);
  if (
    enabledList.status === 200 &&
    (enabledList.body as { data: DetectorRow[] }).data.every((r) => r.enabled === true)
  ) {
    ok("GET /detectors filters by enabled flag");
  } else {
    fail("GET /detectors enabled filter", enabledList);
  }

  const bogusStatus = await request("/detectors?status=bogus", {}, adminToken);
  if (bogusStatus.status === 400) {
    ok("GET /detectors rejects unknown lifecycle status (400)");
  } else {
    fail("GET /detectors bogus status", bogusStatus);
  }

  // --- Settings: alert cooldown validation (non-negative) ---

  const badCooldown = await request(
    `/detectors/${target.id}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({ alertCooldownMs: -100 }),
    },
    adminToken,
  );
  if (badCooldown.status === 400) {
    ok("PATCH settings rejects negative alert cooldown (400)");
  } else {
    fail("PATCH settings negative cooldown", badCooldown);
  }

  const goodCooldown = await request(
    `/detectors/${target.id}/settings`,
    {
      method: "PATCH",
      body: JSON.stringify({ alertCooldownMs: 45000, detectionIntervalMs: 3000, confidenceThreshold: 65 }),
    },
    adminToken,
  );
  const goodCooldownBody = goodCooldown.body as {
    data: {
      confidenceThreshold: number;
      settings: { alertCooldownMs: number; detectionIntervalMs: number };
    };
  };
  if (
    goodCooldown.status === 200 &&
    goodCooldownBody.data.settings.alertCooldownMs === 45000 &&
    goodCooldownBody.data.settings.detectionIntervalMs === 3000 &&
    goodCooldownBody.data.confidenceThreshold === 65
  ) {
    ok("PATCH settings accepts valid cooldown, interval and threshold");
  } else {
    fail("PATCH settings valid cooldown", goodCooldownBody);
  }

  // --- Camera assignment: per-camera enable flag + input support validation ---

  const assignments = await request(
    `/detectors/${target.id}/cameras`,
    {
      method: "PUT",
      body: JSON.stringify({
        assignments: [
          { cameraId: "demo-camera-1", enabled: true },
          { cameraId: "demo-camera-2", enabled: false },
        ],
      }),
    },
    adminToken,
  );
  const assignmentsBody = assignments.body as {
    data: { cameraCount: number; cameras: Array<{ id: string; enabled: boolean }> };
  };
  if (
    assignments.status === 200 &&
    assignmentsBody.data.cameraCount === 2 &&
    assignmentsBody.data.cameras.find((c) => c.id === "demo-camera-2")?.enabled === false
  ) {
    ok("PUT cameras accepts per-camera enable flag");
  } else {
    fail("PUT cameras assignments", assignmentsBody);
  }

  // "fire" supports image/video but NOT webcam; demo-camera-3 is a usb feed.
  const unsupported = await request(
    `/detectors/${target.id}/cameras`,
    {
      method: "PUT",
      body: JSON.stringify({ cameraIds: ["demo-camera-3"] }),
    },
    adminToken,
  );
  if (unsupported.status === 400 && (unsupported.body as { error?: string }).error?.includes("not supported")) {
    ok("PUT cameras rejects feed types the detector does not support (400)");
  } else {
    fail("PUT cameras unsupported input", unsupported);
  }

  const invalidCamera = await request(
    `/detectors/${target.id}/cameras`,
    {
      method: "PUT",
      body: JSON.stringify({ cameraIds: ["no-such-camera"] }),
    },
    adminToken,
  );
  if (invalidCamera.status === 400) {
    ok("PUT cameras rejects invalid camera ids (400)");
  } else {
    fail("PUT cameras invalid id", invalidCamera);
  }

  const mixedBody = await request(
    `/detectors/${target.id}/cameras`,
    {
      method: "PUT",
      body: JSON.stringify({ cameraIds: ["demo-camera-1"], assignments: [{ cameraId: "demo-camera-2", enabled: true }] }),
    },
    adminToken,
  );
  if (mixedBody.status === 400) {
    ok("PUT cameras rejects cameraIds + assignments mixed body (400)");
  } else {
    fail("PUT cameras mixed body", mixedBody);
  }

  // --- Permission enforcement (viewer can read but never manage) ---

  const viewerPatch = await request(
    `/detectors/${target.id}`,
    { method: "PATCH", body: JSON.stringify({ name: "Hacked" }) },
    viewerToken,
  );
  if (viewerPatch.status === 403) {
    ok("viewer cannot update a detector (403)");
  } else {
    fail("viewer PATCH detector", viewerPatch);
  }

  const viewerCameras = await request(
    `/detectors/${target.id}/cameras`,
    { method: "PUT", body: JSON.stringify({ cameraIds: ["demo-camera-4"] }) },
    viewerToken,
  );
  if (viewerCameras.status === 403) {
    ok("viewer cannot assign cameras (403)");
  } else {
    fail("viewer PUT cameras", viewerCameras);
  }

  const viewerSettings = await request(
    `/detectors/${target.id}/settings`,
    { method: "PATCH", body: JSON.stringify({ confidenceThreshold: 10 }) },
    viewerToken,
  );
  if (viewerSettings.status === 403) {
    ok("viewer cannot change detector configuration (403)");
  } else {
    fail("viewer PATCH settings", viewerSettings);
  }

  const viewerRead = await request(`/detectors/${target.id}`, {}, viewerToken);
  if (viewerRead.status === 200) {
    ok("viewer can read detector details");
  } else {
    fail("viewer GET detector", viewerRead);
  }

  const noAuth = await request(`/detectors/${target.id}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) });
  if (noAuth.status === 401) {
    ok("unauthenticated detector update is rejected (401)");
  } else {
    fail("unauthenticated PATCH", noAuth);
  }

  // --- Audit logging for detector management actions ---

  const audit = await request(
    "/audit-logs?limit=50&sortBy=timestamp&sortOrder=desc",
    {},
    adminToken,
  );
  const logs = (audit.body as { data: Array<{ action: string; description: string }> }).data ?? [];
  if (
    logs.some((l) => l.action === "detector_updated" && l.description.includes(target.name)) &&
    logs.some((l) => l.action === "detector_cameras_updated") &&
    logs.some((l) => l.action === "detector_config_updated")
  ) {
    ok("detector management actions are recorded in the audit log");
  } else {
    fail("detector audit trail", logs.map((l) => l.action).slice(0, 10));
  }

  // --- Enable/disable audit trail ---

  await request(`/detectors/${target.id}/disable`, { method: "PATCH" }, adminToken);
  await request(`/detectors/${target.id}/enable`, { method: "PATCH" }, adminToken);
  const auditAfter = await request(
    "/audit-logs?limit=20&sortBy=timestamp&sortOrder=desc",
    {},
    adminToken,
  );
  const recent = (auditAfter.body as { data: Array<{ action: string }> }).data ?? [];
  if (recent.some((l) => l.action === "detector_disabled") && recent.some((l) => l.action === "detector_enabled")) {
    ok("enable and disable actions are recorded in the audit log");
  } else {
    fail("detector enable/disable audit trail", recent.map((l) => l.action).slice(0, 8));
  }

  console.log(`\nDetector management API tests: ${passed} passed, ${failed} failed`);
}

run()
  .catch((err) => {
    fail("detector management suite crashed", String(err));
    console.log(`\nDetector management API tests: ${passed} passed, ${failed} failed`);
  })
  .finally(() => {
    if (server) killProcessTree(server);
    process.exit(failed > 0 ? 1 : 0);
  });