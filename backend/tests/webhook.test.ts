import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import http from "node:http";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 5601;
const TEST_PORT_RANGE = 400;
const RECEIVER_PORT_BASE = 6101;
const RECEIVER_PORT_RANGE = 400;

let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let RECEIVER_PORT = RECEIVER_PORT_BASE + (process.pid % RECEIVER_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;
let RECEIVER_URL = `http://localhost:${RECEIVER_PORT}/webhook`;

let server: ChildProcess | null = null;
let receiver: http.Server | null = null;
let passed = 0;
let failed = 0;
const createdCameraIds: string[] = [];
const deliveredPayloads: Array<{
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  body: Record<string, unknown>;
}> = [];

const WEBHOOK_SECRET = "webhook-test-secret-123";

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

function startReceiver(): Promise<void> {
  return new Promise((resolve, reject) => {
    receiver = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          body = { _raw: rawBody };
        }
        deliveredPayloads.push({
          method: req.method ?? "",
          url: req.url ?? "",
          headers: req.headers,
          rawBody,
          body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true }));
      });
    });
    receiver.once("error", reject);
    receiver.listen(RECEIVER_PORT, "127.0.0.1", () => resolve());
  });
}

function stopReceiver(): Promise<void> {
  return new Promise((resolve) => {
    if (!receiver) return resolve();
    receiver.close(() => resolve());
  });
}

async function waitForDelivery(
  predicate: (entry: { body: Record<string, unknown> }) => boolean,
  timeoutMs = 10000,
): Promise<{ body: Record<string, unknown>; headers: http.IncomingHttpHeaders; rawBody: string } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = deliveredPayloads.find((entry) => predicate(entry));
    if (found) return found;
    await sleep(150);
  }
  return null;
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    RECEIVER_PORT = await resolveTestPort(RECEIVER_PORT_BASE, RECEIVER_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
    RECEIVER_URL = `http://localhost:${RECEIVER_PORT}/webhook`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  await startReceiver();

  console.log(`Starting backend server on port ${TEST_PORT} for webhook tests...`);
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

  // 1) Invalid webhook URL is rejected by settings validation.
  const badUrl = await request(
    "/settings/notifications",
    { method: "PATCH", body: JSON.stringify({ webhook_url: "not-a-url" }) },
    adminToken,
  );
  if (badUrl.status === 400) ok("PATCH settings rejects invalid webhook URL (400)");
  else fail("PATCH settings rejects invalid webhook URL", badUrl);

  // 2) Enable webhooks pointing at the local receiver.
  const enabled = await request(
    "/settings/notifications",
    {
      method: "PATCH",
      body: JSON.stringify({
        webhook_enabled: true,
        webhook_url: RECEIVER_URL,
        webhook_secret: WEBHOOK_SECRET,
      }),
    },
    adminToken,
  );
  const enabledRows = (enabled.body as { data?: Array<{ key: string; value: unknown }> })?.data ?? [];
  if (
    enabled.status === 200 &&
    enabledRows.find((s) => s.key === "webhook_enabled")?.value === true &&
    enabledRows.find((s) => s.key === "webhook_url")?.value === RECEIVER_URL
  ) {
    ok("webhook delivery channel enabled via settings");
  } else {
    fail("webhook delivery channel enabled via settings", enabled);
  }

  // 3) Raise an alert through internal ingestion -> webhook for alert_created.
  const camera = await prisma.camera.create({
    data: {
      name: "Webhook Test Cam",
      url: "rtsp://localhost/none",
      cameraType: "rtsp",
      location: "webhook-test",
    },
  });
  createdCameraIds.push(camera.id);

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

  const alertDelivery = await waitForDelivery((e) => e.body.event === "alert_created");
  if (!alertDelivery) {
    fail("alert_created delivered to webhook", "no webhook payload received");
  } else {
    const { body, headers, rawBody } = alertDelivery;
    if (body.type === "alert" && typeof body.id === "string" && typeof body.severity === "string") {
      ok("alert_created webhook payload has expected shape", { severity: body.severity });
    } else {
      fail("alert_created webhook payload shape", body);
    }

    const signature = typeof headers["x-vigilens-signature"] === "string" ? headers["x-vigilens-signature"] : "";
    const expectedSig = `sha256=${createHmac("sha256", WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex")}`;
    if (signature === expectedSig) {
      ok("webhook payload is signed with HMAC-SHA256");
    } else {
      fail("webhook payload is signed with HMAC-SHA256", { signature, expectedSig });
    }
  }

  // 4) Incident creation + status change are delivered to the webhook.
  const alert = await prisma.alert.findFirst({
    where: { detection: { cameraId: camera.id } },
  });
  if (!alert) {
    fail("incident webhook flow", "no alert found to escalate");
  } else {
    const created = await request(
      "/incidents",
      { method: "POST", body: JSON.stringify({ alertId: alert.id }) },
      adminToken,
    );
    const incidentId = (created.body as { data?: { id: string } })?.data?.id;
    if (created.status === 201 && incidentId) {
      const incidentCreated = await waitForDelivery((e) => e.body.event === "incident_created");
      if (incidentCreated?.body.type === "incident" && incidentCreated.body.id === incidentId) {
        ok("incident_created delivered to webhook");
      } else {
        fail("incident_created delivered to webhook", incidentCreated?.body ?? null);
      }

      const changed = await request(
        `/incidents/${incidentId}/status`,
        { method: "PATCH", body: JSON.stringify({ status: "acknowledged" }) },
        adminToken,
      );
      if (changed.status === 200) {
        const statusDelivery = await waitForDelivery(
          (e) => e.body.event === "incident_status_changed",
        );
        if (statusDelivery?.body.id === incidentId && statusDelivery.body.status === "acknowledged") {
          ok("incident_status_changed delivered to webhook");
        } else {
          fail("incident_status_changed delivered to webhook", statusDelivery?.body ?? null);
        }
      } else {
        fail("incident status change", changed);
      }
    } else {
      fail("incident created from alert", created);
    }
  }

  // 5) Event filters suppress unwanted payloads.
  const deliveryCountBefore = deliveredPayloads.filter((e) => e.body.event === "alert_created").length;
  const filtered = await request(
    "/settings/notifications",
    {
      method: "PATCH",
      body: JSON.stringify({ webhook_alert_created_enabled: false }),
    },
    adminToken,
  );
  if (filtered.status !== 200) {
    fail("disable alert webhooks via settings", filtered);
  } else {
    ok("alert webhooks disabled via settings");
  }

  const cameraB = await prisma.camera.create({
    data: {
      name: "Webhook Test Cam B",
      url: "rtsp://localhost/none",
      cameraType: "rtsp",
      location: "webhook-test-b",
    },
  });
  createdCameraIds.push(cameraB.id);

  const ingestB = await request(
    "/detections/internal",
    {
      method: "POST",
      headers: { "X-Internal-Key": internalKey },
      body: JSON.stringify({
        camera_id: cameraB.id,
        label: "person",
        confidence: 0.9,
        detector_key: "person",
        class_name: "person",
        image_url: "",
        skip_alert: false,
      }),
    },
    adminToken,
  );
  if (ingestB.status !== 201) {
    fail("second internal detection ingestion", ingestB);
  }

  await sleep(2500);
  const deliveryCountAfter = deliveredPayloads.filter((e) => e.body.event === "alert_created").length;
  if (deliveryCountAfter === deliveryCountBefore) {
    ok("alert webhooks suppressed when the event filter is disabled");
  } else {
    fail("alert webhooks suppressed when disabled", {
      before: deliveryCountBefore,
      after: deliveryCountAfter,
    });
  }

  // 6) Disabling the channel entirely stops delivery.
  const totalBefore = deliveredPayloads.length;
  const disabled = await request(
    "/settings/notifications",
    {
      method: "PATCH",
      body: JSON.stringify({ webhook_enabled: false, webhook_alert_created_enabled: true }),
    },
    adminToken,
  );
  if (disabled.status !== 200) {
    fail("disable webhooks via settings", disabled);
  } else {
    ok("webhook channel disabled via settings");
  }

  const cameraC = await prisma.camera.create({
    data: {
      name: "Webhook Test Cam C",
      url: "rtsp://localhost/none",
      cameraType: "rtsp",
      location: "webhook-test-c",
    },
  });
  createdCameraIds.push(cameraC.id);

  const ingestC = await request(
    "/detections/internal",
    {
      method: "POST",
      headers: { "X-Internal-Key": internalKey },
      body: JSON.stringify({
        camera_id: cameraC.id,
        label: "person",
        confidence: 0.9,
        detector_key: "person",
        class_name: "person",
        image_url: "",
        skip_alert: false,
      }),
    },
    adminToken,
  );
  if (ingestC.status !== 201) {
    fail("third internal detection ingestion", ingestC);
  }

  await sleep(2500);
  if (deliveredPayloads.length === totalBefore) {
    ok("no webhook payloads delivered while the channel is disabled");
  } else {
    fail("no webhook payloads while disabled", {
      before: totalBefore,
      after: deliveredPayloads.length,
    });
  }

  // 7) Settings reset returns webhook defaults.
  const reset = await request("/settings/notifications/reset", { method: "POST" }, adminToken);
  const resetRows = (reset.body as { data?: Array<{ key: string; value: unknown }> })?.data ?? [];
  if (reset.status === 200 && resetRows.find((s) => s.key === "webhook_enabled")?.value === false) {
    ok("settings reset restores webhook defaults");
  } else {
    fail("settings reset restores webhook defaults", reset);
  }
}

run()
  .catch((err) => fail("webhook test crash", String(err)))
  .finally(async () => {
    try {
      await prisma.camera.deleteMany({ where: { id: { in: createdCameraIds } } });
    } catch {
      // cascade may have removed them already
    }
    await stopReceiver();
    if (server) killProcessTree(server);
    await prisma.$disconnect();
    console.log(`\nWebhook test: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });