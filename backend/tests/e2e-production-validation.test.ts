import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 5721;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}`;

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

/** Opens an SSE stream and resolves once the buffer contains the marker. */
async function collectSseUntil(marker: string, token: string, timeoutMs = 12000): Promise<string | null> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let buffer = "";
    let settled = false;
    const done = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setTimeout(() => controller.abort(), 10);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);

    const run = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/realtime/events`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });
        const reader = res.body?.getReader();
        if (!reader) {
          done(null);
          return;
        }
        const decoder = new TextDecoder();
        const read = async () => {
          const { value, done: finished } = await reader.read();
          if (finished) {
            done(null);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          if (buffer.includes(marker)) {
            done(buffer);
            return;
          }
          await read();
        };
        await read();
      } catch {
        done(null);
      }
    };
    void run();
  });
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for E2E production validation...`);
  server = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    {
      cwd: process.cwd(),
      stdio: "ignore",
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        NODE_ENV: "test",
        MONITOR_ENABLED: "false",
      },
    },
  );

  if (!(await waitForServer())) {
    fail("server startup", `backend did not become healthy on port ${TEST_PORT}`);
    return;
  }
  ok("server started and /health responds");

  // ────────────────────────────────────────────────────────────
  // 1. UNAUTHENTICATED LIVENESS + READINESS
  // ────────────────────────────────────────────────────────────
  const health = await request("/health");
  const hb = health.body as Record<string, unknown>;
  if (health.status === 200 && hb.status === "ok") {
    ok("GET /health returns liveness OK");
  } else {
    fail("GET /health", health);
  }

  const live = await request("/health/live");
  const lb = live.body as Record<string, unknown>;
  if (live.status === 200 && lb.status === "ok") {
    ok("GET /health/live returns ok");
  } else {
    fail("GET /health/live", live);
  }

  const ready = await request("/health/ready");
  const readyBody = ready.body as { data?: { status?: string } };
  const readyStatus = (readyBody.data ?? readyBody) as { status?: string };
  if ((ready.status === 200 || ready.status === 503) && typeof readyStatus.status === "string") {
    ok(`GET /health/ready returns ${ready.status} with status field`);
  } else {
    fail("GET /health/ready", ready);
  }

  // Unknown route returns consistent error format
  const notFound = await request("/api/nonexistent-route-e2e");
  const nf = notFound.body as Record<string, unknown>;
  if (
    notFound.status === 404 &&
    nf.success === false &&
    typeof nf.requestId === "string" &&
    typeof nf.endpoint === "string"
  ) {
    ok("unknown route returns standardized 404 with requestId");
  } else {
    fail("unknown route 404", { status: notFound.status, body: nf });
  }

  // ────────────────────────────────────────────────────────────
  // 2. AUTHENTICATION
  // ────────────────────────────────────────────────────────────
  const unauthSystem = await request("/api/system/monitoring");
  if (unauthSystem.status === 401) {
    ok("protected endpoints require authentication (401)");
  } else {
    fail("unauth monitoring", unauthSystem);
  }

  async function login(email: string, password = "admin123") {
    return request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }) as Promise<{ status: number; body: { data: { token: string } } }>;
  }

  const superLogin = await login("super@vigilens.io");
  if (superLogin.status !== 200 || !superLogin.body?.data?.token) {
    fail("super admin login", superLogin);
    return;
  }
  const adminToken = superLogin.body.data.token;
  ok("super admin login succeeds and returns JWT");

  const me = await request("/api/auth/me", {}, adminToken);
  const meData = me.body as { data?: { email?: string; role?: string } };
  if (me.status === 200 && meData.data?.email === "super@vigilens.io" && meData.data?.role === "super_admin") {
    ok("GET /auth/me returns super admin profile");
  } else {
    fail("GET /auth/me", me);
  }

  // ────────────────────────────────────────────────────────────
  // 3. CAMERA CRUD
  // ────────────────────────────────────────────────────────────
  const createCam = await request("/api/cameras", {
    method: "POST",
    body: JSON.stringify({
      name: "E2E Test Camera",
      url: "rtsp://127.0.0.1:554/test",
      cameraType: "rtsp",
      location: "Test Lab",
    }),
  }, adminToken);

  let cameraId: string | null = null;
  if (createCam.status === 201) {
    const camData = createCam.body as { data?: { id?: string; name?: string } };
    cameraId = camData.data?.id ?? null;
    if (cameraId && camData.data?.name === "E2E Test Camera") {
      ok("POST /api/cameras creates a camera");
    } else {
      fail("camera create response", createCam);
    }
  } else {
    fail("camera create", createCam);
  }

  if (cameraId) {
    const getCam = await request(`/api/cameras/${cameraId}`, {}, adminToken);
    if (getCam.status === 200) {
      ok("GET /api/cameras/:id retrieves created camera");
    } else {
      fail("camera get", getCam);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 4. INTERNAL DETECTION INGESTION → AUTO-ALERT
  // ────────────────────────────────────────────────────────────
  if (cameraId) {
    const ingest = await request("/api/detections/internal", {
      method: "POST",
      headers: { "X-Internal-Key": "dev-internal-key-change-in-production" },
      body: JSON.stringify({
        camera_id: cameraId,
        label: "person",
        confidence: 0.97,
        detector_key: "person",
        class_name: "person",
        model_version: "v1.0-e2e",
        processing_time_ms: 35,
        image_url: "https://example.com/e2e.jpg",
        skip_alert: false,
      }),
    });

    if (ingest.status === 201) {
      const detData = ingest.body as { data?: { id?: string; label?: string; status?: string } };
      if (detData.data?.label === "person" && detData.data?.status === "critical") {
        ok("internal detection ingestion creates detection (critical)");
      } else {
        fail("internal detection response", ingest);
      }
    } else {
      fail("internal detection ingest", ingest);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 4b. REALTIME SSE DELIVERY (live alert pushed while subscribed)
  // ────────────────────────────────────────────────────────────
  if (cameraId) {
    const sse = collectSseUntil("alert_created", adminToken);
    await sleep(500);
    const liveIngest = await request("/api/detections/internal", {
      method: "POST",
      headers: { "X-Internal-Key": "dev-internal-key-change-in-production" },
      body: JSON.stringify({
        camera_id: cameraId,
        label: "bicycle",
        confidence: 0.94,
        detector_key: "bicycle",
        class_name: "bicycle",
        track_id: "e2e-sse-1",
        image_url: "https://example.com/e2e-bicycle.jpg",
        skip_alert: false,
      }),
    });
    if (liveIngest.status !== 201) {
      fail("SSE-triggering ingestion", liveIngest);
    }
    const sseBuffer = await sse;
    if (sseBuffer !== null && sseBuffer.includes("alert_created")) {
      ok("live alert_created event delivered over SSE to a subscriber");
    } else {
      fail("SSE alert delivery", { received: sseBuffer?.slice(0, 200) ?? null });
    }
  }

  // ────────────────────────────────────────────────────────────
  // 5. ALERT LIFECYCLE
  // ────────────────────────────────────────────────────────────
  const alerts = await request("/api/alerts?page=1&limit=10", {}, adminToken);
  const alertBody = alerts.body as { data?: Array<{ id: string; title: string; severity: string }> };
  const alertsArr = alertBody.data ?? [];
  const testAlert = alertsArr.find((a) => a.title.includes("person")) ?? alertsArr[0];

  if (alerts.status === 200 && alertsArr.length > 0 && testAlert) {
    ok(`GET /api/alerts returns ${alertsArr.length} alert(s) including detection-triggered alert`);
  } else {
    fail("alerts list", alerts);
  }

  let alertId: string | null = testAlert?.id ?? null;
  if (alertId) {
    const unread = await request("/api/alerts/unread-count", {}, adminToken);
    const unreadData = unread.body as { data?: { count?: number } };
    if (unread.status === 200 && typeof unreadData.data?.count === "number") {
      ok("GET /api/alerts/unread-count returns count");
    } else {
      fail("unread count", unread);
    }

    const markRead = await request(`/api/alerts/${alertId}/read`, { method: "PATCH" }, adminToken);
    if (markRead.status === 200) {
      ok("PATCH /api/alerts/:id/read marks alert as read");
    } else {
      fail("mark alert read", markRead);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 6. INCIDENT LIFECYCLE
  // ────────────────────────────────────────────────────────────
  let incidentId: string | null = null;
  if (alertId) {
    const createInc = await request("/api/incidents", {
      method: "POST",
      body: JSON.stringify({ alertId, priority: "critical", description: "E2E validation incident" }),
    }, adminToken);

    if (createInc.status === 201) {
      const incData = createInc.body as { data?: { id?: string; status?: string } };
      incidentId = incData.data?.id ?? null;
      if (incidentId) {
        ok("POST /api/incidents creates incident");
      } else {
        fail("incident create response", createInc);
      }
    } else {
      fail("incident create", createInc);
    }
  }

  if (incidentId) {
    const ackStatus = await request(`/api/incidents/${incidentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged" }),
    }, adminToken);
    if (ackStatus.status === 200) {
      ok("PATCH /api/incidents/:id/status acknowledges incident");
    } else {
      fail("incident acknowledge", ackStatus);
    }

    const updateStatus = await request(`/api/incidents/${incidentId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "investigating" }),
    }, adminToken);
    if (updateStatus.status === 200) {
      ok("PATCH /api/incidents/:id/status transitions to investigating");
    } else {
      fail("incident status update", updateStatus);
    }

    const addNote = await request(`/api/incidents/${incidentId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: "E2E test note" }),
    }, adminToken);
    if (addNote.status === 201) {
      ok("POST /api/incidents/:id/notes adds note");
    } else {
      fail("incident add note", addNote);
    }

    const getInc = await request(`/api/incidents/${incidentId}`, {}, adminToken);
    const incBody = getInc.body as { data?: { id?: string; status?: string; notes?: unknown[]; activity?: unknown[] } };
    if (
      getInc.status === 200 &&
      incBody.data?.status === "investigating" &&
      Array.isArray(incBody.data?.notes) &&
      incBody.data.notes.length >= 1 &&
      Array.isArray(incBody.data?.activity) &&
      incBody.data.activity.length >= 3
    ) {
      ok("GET /api/incidents/:id shows status, note and activity trail");
    } else {
      fail("incident detail", getInc);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 7. SETTINGS
  // ────────────────────────────────────────────────────────────
  const settings = await request("/api/settings/general", {}, adminToken);
  const settingsBody = settings.body as { data?: Array<{ key: string; category: string; value: unknown }> };
  if (
    settings.status === 200 &&
    Array.isArray(settingsBody.data) &&
    settingsBody.data.length > 0 &&
    settingsBody.data.every((s) => s.category === "general" && typeof s.key === "string")
  ) {
    ok("GET /api/settings/general returns serialized settings");
  } else {
    fail("settings get", settings);
  }

  const allSettings = await request("/api/settings", {}, adminToken);
  const allBody = allSettings.body as { data?: Array<{ key: string }> };
  if (allSettings.status === 200 && Array.isArray(allBody.data) && allBody.data.length > 0) {
    ok("GET /api/settings returns all settings");
  } else {
    fail("settings all", allSettings);
  }

  // ────────────────────────────────────────────────────────────
  // 8. RBAC ENFORCEMENT
  // ────────────────────────────────────────────────────────────
  const operatorLogin = await login("operator@vigilens.io");
  if (operatorLogin.status !== 200) {
    fail("operator login", operatorLogin);
    return;
  }
  const opToken = operatorLogin.body.data.token;

  const opMon = await request("/api/system/monitoring", {}, opToken);
  if (opMon.status === 403) {
    ok("operator without monitoring.read is denied (403)");
  } else {
    fail("operator RBAC denial", opMon);
  }

  const opSettings = await request("/api/settings/general", {}, opToken);
  if (opSettings.status === 403) {
    ok("operator without settings.read is denied (403)");
  } else {
    fail("operator settings denial", opSettings);
  }

  // ────────────────────────────────────────────────────────────
  // 9. SYSTEM OBSERVABILITY
  // ────────────────────────────────────────────────────────────
  const metrics = await request("/api/system/metrics", {}, adminToken);
  const met = metrics.body as { data?: { requests?: { total?: number; statusCodes?: Record<string, number>; topEndpoints?: Array<{ endpoint: string; count: number }> }; operations?: { counters?: Record<string, number>; gauges?: Record<string, number> } } };
  if (
    metrics.status === 200 &&
    typeof met?.data?.requests?.total === "number" &&
    met.data.requests.total > 0 &&
    typeof met?.data?.requests?.statusCodes === "object" &&
    (met.data.requests.statusCodes["201"] ?? 0) >= 1 &&
    Array.isArray(met.data.requests.topEndpoints) &&
    met.data.requests.topEndpoints.length > 0 &&
    typeof met?.data?.operations?.counters === "object" &&
    typeof met?.data?.operations?.gauges === "object"
  ) {
    ok("GET /api/system/metrics reports request breakdown and operational counters");
  } else {
    fail("system metrics", metrics);
  }

  const logs = await request("/api/system/logs?limit=200", {}, adminToken);
  const logsBody = logs.body as { data?: Array<{ level: string; message: string; meta?: Record<string, unknown> }> };
  const sawLoginRequest =
    Array.isArray(logsBody.data) &&
    logsBody.data.some(
      (e) =>
        e.message === "HTTP request" &&
        e.meta?.endpoint === "/api/auth/login" &&
        e.meta?.statusCode === 200,
    );
  if (
    logs.status === 200 &&
    Array.isArray(logsBody.data) &&
    logsBody.data.length > 0 &&
    logsBody.data.every((e) => typeof e.level === "string" && typeof e.message === "string") &&
    sawLoginRequest
  ) {
    ok("GET /api/system/logs returns entries including this session's login");
  } else {
    fail("system logs", logs);
  }

  const monitoring = await request("/api/system/monitoring", {}, adminToken);
  const mon = monitoring.body as { data?: { status?: string; version?: string; services?: unknown[]; resources?: { cpu?: unknown; memory?: unknown } } };
  if (
    monitoring.status === 200 &&
    typeof mon?.data?.status === "string" &&
    typeof mon?.data?.version === "string" &&
    Array.isArray(mon.data.services) &&
    mon.data.services.length >= 3 &&
    typeof mon?.data?.resources?.cpu === "object"
  ) {
    ok("GET /api/system/monitoring returns services, version, and resource usage");
  } else {
    fail("system monitoring", monitoring);
  }

  // ────────────────────────────────────────────────────────────
  // 10. AUDIT LOG VERIFICATION
  // ────────────────────────────────────────────────────────────
  const auditLogs = await request("/api/audit-logs?page=1&limit=20", {}, adminToken);
  const auditBody = auditLogs.body as { data?: Array<{ action: string; module: string; description: string }> };
  const auditEntries = auditBody.data ?? [];
  const hasDetectionAudit = auditEntries.some((e) => e.action === "detection_created" || e.action === "alert_created");
  if (auditLogs.status === 200 && auditEntries.length > 0 && hasDetectionAudit) {
    ok(`GET /api/audit-logs contains detection/alert audit entries (${auditEntries.length} total)`);
  } else {
    fail("audit logs verification", auditLogs);
  }

  // ────────────────────────────────────────────────────────────
  // 11. CAMERA CLEANUP
  // ────────────────────────────────────────────────────────────
  if (cameraId) {
    const deleteCam = await request(`/api/cameras/${cameraId}`, { method: "DELETE" }, adminToken);
    if (deleteCam.status === 200) {
      ok("DELETE /api/cameras/:id removes camera");
    } else {
      fail("camera delete", deleteCam);
    }

    const verifyGone = await request(`/api/cameras/${cameraId}`, {}, adminToken);
    if (verifyGone.status === 404) {
      ok("deleted camera returns 404");
    } else {
      fail("camera gone verification", verifyGone);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 12. VERSION + PROCESS UPTIME
  // ────────────────────────────────────────────────────────────
  const snap = metrics.body as { data?: { version?: string; uptime?: { processSeconds?: number } } };
  if (typeof snap?.data?.version === "string" && snap.data.version.length > 0 && typeof snap?.data?.uptime?.processSeconds === "number") {
    ok(`metrics snapshot shows version=${snap.data.version} and uptime=${snap.data.uptime.processSeconds}s`);
  } else {
    fail("version/uptime in snapshot", snap);
  }

  // ────────────────────────────────────────────────────────────
  // 13. NOTIFICATIONS SETTINGS (includes webhook configuration)
  // ────────────────────────────────────────────────────────────
  const whStatus = await request("/api/settings/notifications", {}, adminToken);
  const notifBody = whStatus.body as { data?: Array<{ key: string; category: string }> };
  const hasWebhookKeys =
    Array.isArray(notifBody.data) &&
    notifBody.data.length > 0 &&
    notifBody.data.some((s) => s.key.includes("webhook_"));
  if (whStatus.status === 200 && hasWebhookKeys) {
    ok("notifications settings include webhook configuration keys");
  } else {
    fail("notifications webhook settings", whStatus);
  }
}

run()
  .then(() => {
    if (server) killProcessTree(server);
    console.log(`\nE2E production validation: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
  })
  .catch((err) => {
    if (server) killProcessTree(server);
    console.error(err);
    process.exit(1);
  });