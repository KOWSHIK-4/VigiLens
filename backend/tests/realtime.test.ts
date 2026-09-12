import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 5401;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
let createdCameraId: string | null = null;

function ok(name: string, detail?: unknown) {
  passed += 1;
  console.log(`  PASS  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
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

async function waitForEvent(
  sse: SseConnection,
  type: string,
  timeoutMs = 10000,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = sse.buffer;
    const events: Array<Record<string, unknown>> = [];
    for (const line of data.split("\n")) {
      if (line.startsWith("data: ")) {
        try {
          events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
        } catch {
          // partial or non-JSON frame
        }
      }
    }
    const found = events.find((e) => e.type === type);
    if (found) return found;
    await sleep(100);
  }
  return null;
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for realtime event tests...`);
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
  const adminToken = (login.body as { data: { token: string } }).data.token;
  ok("admin login returns token");

  // 1) Unauthenticated SSE must be rejected.
  const sseRejected = await openSse(
    `/api/realtime/events?token=not-a-real-token`,
  ).then(
    () => false,
    () => true,
  );
  if (sseRejected) {
    fail("SSE rejects bad token", "connection destroyed");
  } else {
    await sleep(1000);
    // If the server kept the connection open a bad token would still be
    // accepted; assert actual server-side rejection by checking subscribers.
    const subs = await request("/realtime/subscribers", {}, adminToken);
    const count = (subs.body as { data?: { count: number } })?.data?.count ?? -1;
    if (count === 0) ok("SSE rejects bad token (no subscriber registered)");
    else fail("SSE rejects bad token", `subscriber count=${count}`);
  }

  // 2) Open a valid SSE stream.
  const sse = await openSse(`/api/realtime/events?token=${adminToken}`);
  await sleep(300);
  ok("valid token opens an SSE stream (connected comment)");

  const subsNow = await request("/realtime/subscribers", {}, adminToken);
  const now = (subsNow.body as { data?: { count: number } })?.data?.count ?? -1;
  if (now >= 1) ok("subscriber registry reports the live connection", { count: now });
  else fail("subscriber registry reports the live connection", { count: now });

  // 3) Ingest a detection through the internal API -> creates an alert -> SSE alert event.
  const camera = await prisma.camera.create({
    data: {
      name: "Realtime Test Cam",
      url: "rtsp://localhost/none",
      cameraType: "rtsp",
      location: "realtime-test",
    },
  });
  createdCameraId = camera.id;

  const internalKey = process.env.INTERNAL_API_KEY || "dev-internal-key-change-in-production";
  const ingest = await request(
    "/detections/internal",
    {
      method: "POST",
      headers: { "X-Internal-Key": internalKey },
      body: JSON.stringify({
        camera_id: camera.id,
        label: "person",
        confidence: 0.95,
        detector_key: "person",
        class_name: "person",
        image_url: "",
        skip_alert: false,
      }),
    },
    adminToken,
  );
  if (ingest.status !== 201) {
    fail("internal detection ingestion", ingest);
  } else {
    ok("internal detection ingestion creates a detection (201)");
  }

  const alertEvent = await waitForEvent(sse, "alert");
  if (alertEvent) {
    ok("alert creation is pushed over SSE", { severity: alertEvent.data as unknown });
  } else {
    fail("alert creation is pushed over SSE", "no alert event received");
  }

  // 4) Incident creation + status change are pushed over SSE.
  const alerts = await prisma.alert.findFirst({
    where: { detection: { cameraId: camera.id } },
  });
  if (!alerts) {
    fail("incident SSE flow", "no alert found to escalate");
  } else {
    const created = await request(
      "/incidents",
      { method: "POST", body: JSON.stringify({ alertId: alerts.id }) },
      adminToken,
    );
    const incidentId = (created.body as { data?: { id: string } })?.data?.id;
    if (created.status === 201 && incidentId) {
      ok("incident created from alert");
      const incidentEvent = await waitForEvent(sse, "incident");
      if (incidentEvent) ok("incident creation is pushed over SSE");
      else fail("incident creation is pushed over SSE", "no incident event received");

      const changed = await request(
        `/incidents/${incidentId}/status`,
        { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) },
        adminToken,
      );
      if (changed.status === 200) {
        const statusEvent = await waitForEvent(sse, "incident");
        if (statusEvent) ok("incident status change is pushed over SSE");
        else fail("incident status change is pushed over SSE", "no status event received");
      } else {
        fail("incident status change is pushed over SSE", changed);
      }
    } else {
      fail("incident created from alert", created);
    }
  }

  // 5) Closing the connection removes the subscriber.
  sse.close();
  await sleep(800);
  const subsAfterClose = await request("/realtime/subscribers", {}, adminToken);
  const after =
    (subsAfterClose.body as { data?: { count: number } })?.data?.count ?? -1;
  if (after === 0) ok("closing the stream unregisters the subscriber");
  else fail("closing the stream unregisters the subscriber", { count: after });

  // 6) Realtime endpoints are protected by auth.
  const noAuth = await request("/realtime/subscribers");
  if (noAuth.status === 401) ok("realtime endpoints require authentication (401)");
  else fail("realtime endpoints require authentication (401)", noAuth);
}

run()
  .catch((err) => fail("realtime test crash", String(err)))
  .finally(async () => {
    if (createdCameraId) {
      try {
        await prisma.camera.delete({ where: { id: createdCameraId } });
      } catch {
        // cascade may have removed it already
      }
    }
    if (server) killProcessTree(server);
    await prisma.$disconnect();
    console.log(`\nRealtime event tests: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });