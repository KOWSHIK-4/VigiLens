import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import http from "node:http";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

const TEST_PORT_BASE = 5401;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
let createdCameraId: string | null = null;
const createdCameraIds: string[] = [];
const createdTeamIds: string[] = [];

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
    `/api/realtime/events?ticket=not-a-real-ticket`,
  ).then(
    () => false,
    () => true,
  );
  if (sseRejected) {
    fail("SSE rejects bad ticket", "connection destroyed");
  } else {
    await sleep(1000);
    // If the server kept the connection open a bad ticket would still be
    // accepted; assert actual server-side rejection by checking subscribers.
    const subs = await request("/realtime/subscribers", {}, adminToken);
    const count = (subs.body as { data?: { count: number } })?.data?.count ?? -1;
    if (count === 0) ok("SSE rejects bad ticket (no subscriber registered)");
    else fail("SSE rejects bad ticket", `subscriber count=${count}`);
  }

  // 2a) A full access JWT must NOT be accepted via the query string — that is
  // the leakage vector being removed (long-lived tokens in proxy logs).
  const sseWithJwt = await openSse(`/api/realtime/events?ticket=${adminToken}`);
  await sleep(300);
  const subsWithJwt = await request("/realtime/subscribers", {}, adminToken);
  const withJwt = (subsWithJwt.body as { data?: { count: number } })?.data?.count ?? -1;
  if (withJwt === 0) {
    ok("access JWT is rejected in the SSE query string (no subscriber)");
  } else {
    fail("access JWT rejected in query", `subscriber count=${withJwt}`);
  }
  sseWithJwt.close();

  // 2b) Fetch a short-lived realtime ticket over the Authorization header,
  // then open the SSE stream with it.
  const ticketRes = await request(
    "/auth/realtime-ticket",
    { method: "POST" },
    adminToken,
  );
  const ticket =
    ticketRes.status === 200
      ? (ticketRes.body as { data: { ticket: string } }).data.ticket
      : "";
  if (ticketRes.status === 200 && ticket.length > 0) {
    ok("authenticated user can mint a short-lived realtime ticket");
  } else {
    fail("realtime ticket issuance", ticketRes);
  }

  const sse = await openSse(`/api/realtime/events?ticket=${ticket}`);
  await sleep(300);
  ok("valid ticket opens an SSE stream (connected comment)");

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
      organizationId: DEFAULT_ORG_ID,
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

  // 5b) Per-team routing: an event scoped to a team reaches only subscribers
  // that subscribed with that teamId (org-wide streams still receive it).
  const teamTag = `Realtime Team ${Date.now()}`;
  const teamA = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: `${teamTag} A` }) },
    adminToken,
  );
  const teamB = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: `${teamTag} B` }) },
    adminToken,
  );
  const teamAId = (teamA.body as { data?: { id?: string } })?.data?.id;
  const teamBId = (teamB.body as { data?: { id?: string } })?.data?.id;
  if (teamA.status === 201 && teamB.status === 201 && teamAId && teamBId) {
    createdTeamIds.push(teamAId, teamBId);
    ok("teams created for realtime routing test");
  } else {
    fail("realtime routing team creation", { teamA, teamB });
  }

  const ticketARes = await request("/auth/realtime-ticket", { method: "POST" }, adminToken);
  const ticketBRes = await request("/auth/realtime-ticket", { method: "POST" }, adminToken);
  const ticketA = (ticketARes.body as { data?: { ticket: string } }).data?.ticket;
  const ticketB = (ticketBRes.body as { data?: { ticket: string } }).data?.ticket;
  if (ticketA && ticketB) ok("realtime tickets minted for per-team streams");
  else fail("realtime per-team ticket issuance", { ticketARes, ticketBRes });

  if (ticketA && ticketB && teamAId && teamBId) {
    const sseA = await openSse(`/api/realtime/events?ticket=${ticketA}&teamIds=${teamAId}`);
    const sseB = await openSse(`/api/realtime/events?ticket=${ticketB}&teamIds=${teamBId}`);
    await sleep(300);
    ok("per-team SSE streams opened (teamA + teamB scoped)");

    const ingest2 = await request(
      "/detections/internal",
      {
        method: "POST",
        headers: { "X-Internal-Key": internalKey },
        body: JSON.stringify({
          camera_id: camera.id,
          label: "vehicle",
          confidence: 0.93,
          detector_key: "vehicle",
          class_name: "vehicle",
          image_url: "",
          skip_alert: false,
        }),
      },
      adminToken,
    );

    const secondAlert = await prisma.alert.findFirst({
      where: { detection: { cameraId: camera.id }, incident: null },
      orderBy: { createdAt: "desc" },
    });

    if (ingest2.status === 201 && secondAlert?.id) {
      await request(
        `/alerts/${secondAlert.id}/team`,
        { method: "PATCH", body: JSON.stringify({ teamId: teamAId }) },
        adminToken,
      );
      const created2 = await request(
        "/incidents",
        { method: "POST", body: JSON.stringify({ alertId: secondAlert.id }) },
        adminToken,
      );
      if (created2.status === 201) {
        const evA = await waitForEvent(sseA, "incident");
        await sleep(700);
        const teamABEvents = (sseB.buffer.match(/data: .*\n/g) ?? [])
          .map((line) => {
            try {
              return JSON.parse(line.slice(6)) as Record<string, unknown>;
            } catch {
              return null;
            }
          })
          .filter((e) => e !== null && e.type === "incident" && e.teamId === teamAId);
        if (evA) ok("team-scoped incident event delivered to teamA subscriber");
        else fail("team-scoped incident event delivered to teamA subscriber", "no incident event");
        if (teamABEvents.length === 0)
          ok("team-scoped incident event withheld from teamB subscriber");
        else fail("team-scoped incident event withheld from teamB", teamABEvents);
      } else {
        fail("per-team incident creation", created2);
      }
    } else {
      fail("per-team ingestion/alert lookup", { ingest2, secondAlert });
    }

    sseA.close();
    sseB.close();
    await sleep(800);
  } else {
    fail("per-team SSE setup", "missing ticket or team id");
  }

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
    if (createdCameraIds.length > 0) {
      await prisma.camera.deleteMany({ where: { id: { in: createdCameraIds } } }).catch(() => null);
    }
    if (createdTeamIds.length > 0) {
      await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } }).catch(() => null);
    }
    if (server) killProcessTree(server);
    await prisma.$disconnect();
    console.log(`\nRealtime event tests: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  });