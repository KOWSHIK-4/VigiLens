import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 4941;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;

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

type IncidentBody = {
  data?: {
    id: string;
    status: string;
    priority: string;
    title: string;
    assignedToUserId?: string | null;
    assignedToName?: string | null;
    resolvedAt?: string | null;
    resolvedByName?: string | null;
    notes?: Array<{ body: string; authorName: string }>;
    activity?: Array<{ action: string; fromValue?: string | null; toValue?: string | null }>;
  } | null;
};

async function run() {
  let cameraId: string | null = null;
  const createdUserIds: string[] = [];

  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for incident API tests...`);
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

  // Assignable users, one active and one disabled.
  const passwordHash = await bcrypt.hash("incident123", 12);
  const activeUser = await prisma.user.upsert({
    where: { email: "incident-assignee@vigilens.io" },
    update: { status: "active", role: "operator" },
    create: {
      email: "incident-assignee@vigilens.io",
      password: passwordHash,
      name: "Incident Assignee",
      role: "operator",
      status: "active",
    },
  });
  createdUserIds.push(activeUser.id);

  const disabledUser = await prisma.user.upsert({
    where: { email: "incident-disabled@vigilens.io" },
    update: { status: "disabled", role: "viewer" },
    create: {
      email: "incident-disabled@vigilens.io",
      password: passwordHash,
      name: "Incident Disabled",
      role: "viewer",
      status: "disabled",
    },
  });
  createdUserIds.push(disabledUser.id);

  // Viewer token (alerts.read only, no alerts.manage) for RBAC assertions.
  const viewerLogin = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "viewer@vigilens.io", password: "admin123" }),
  });
  const viewerToken =
    viewerLogin.status === 200
      ? (viewerLogin.body as { data?: { token?: string } }).data?.token
      : undefined;

  // Fixture: camera + detections + alerts to turn into incidents.
  const camera = await prisma.camera.create({
    data: { name: "incident-api-test-cam", url: "/dev/null", cameraType: "usb" },
  });
  cameraId = camera.id;

  const makeDetection = (label: string, confidence: number) =>
    prisma.detection.create({
      data: { cameraId: camera.id, label, confidence, imageUrl: "incident.jpg" },
    });
  const makeAlert = (detection: Awaited<ReturnType<typeof makeDetection>>, severity: "critical" | "warning", title: string, message: string) =>
    prisma.alert.create({ data: { detectionId: detection.id, severity, title, message } });

  const detA = await makeDetection("incident-person-a", 0.91);
  const detB = await makeDetection("incident-person-b", 0.9);
  const detC = await makeDetection("incident-person-c", 0.89);
  const alertA = await makeAlert(detA, "critical", "Critical incident test alert", "critical path");
  const alertB = await makeAlert(detB, "warning", "Warning incident test alert", "warning path");
  const alertC = await makeAlert(detC, "critical", "Reopened incident test alert", "reopen path");

  // --- Validation ---
  let res = await request("/incidents?status=bogus", {}, adminToken);
  assertStatus(res.status, 400, "status=bogus is rejected with 400", "incident status validation");

  res = await request("/incidents?limit=1000", {}, adminToken);
  assertStatus(res.status, 400, "limit=1000 is rejected with 400", "incident limit validation");

  res = await request("/incidents?assignedTo=not-a-uuid", {}, adminToken);
  assertStatus(res.status, 400, "assignedTo=not-a-uuid is rejected with 400", "incident assignedTo validation");

  res = await request("/incidents/not-a-uuid", {}, adminToken);
  assertStatus(res.status, 400, "GET /incidents/not-a-uuid is rejected with 400", "incident id validation");

  const randomUuid = "00000000-0000-4000-8000-000000000000";
  res = await request(`/incidents/${randomUuid}`, {}, adminToken);
  assertStatus(res.status, 404, "GET unknown incident returns 404", "incident getById");

  res = await request("/incidents", {
    method: "POST",
    body: JSON.stringify({ alertId: randomUuid }),
  }, adminToken);
  assertStatus(res.status, 404, "creating an incident from an unknown alert returns 404", "incident create 404");

  res = await request("/incidents", {
    method: "POST",
    body: JSON.stringify({}),
  }, adminToken);
  assertStatus(res.status, 400, "creating an incident without alertId returns 400", "incident create validation");

  // --- Create from alert ---
  res = await request("/incidents", {
    method: "POST",
    body: JSON.stringify({ alertId: alertA.id }),
  }, adminToken);
  const incidentBody = res.body as IncidentBody;
  if (res.status === 201 && incidentBody?.data?.id) {
    ok("POST /incidents creates an incident from an alert");
  } else {
    fail("incident create from alert", res);
  }
  const incidentAId = incidentBody?.data?.id;
  if (incidentAId) {
    // Status flow: new -> acknowledged -> investigating (each valid edge).
    res = await request(`/incidents/${incidentAId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged" }),
    }, adminToken);
    assertStatus(res.status, 200, "new -> acknowledged is allowed", "incident transition");

    res = await request(`/incidents/${incidentAId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "investigating" }),
    }, adminToken);
    assertStatus(res.status, 200, "acknowledged -> investigating is allowed", "incident transition");

    res = await request(`/incidents/${incidentAId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "new" }),
    }, adminToken);
    assertStatus(res.status, 422, "investigating -> new is rejected as an invalid transition", "incident invalid transition");

    res = await request(`/incidents/${incidentAId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "bogus" }),
    }, adminToken);
    assertStatus(res.status, 400, "a bogus target status is rejected with 400", "incident status value validation");
  }

  // Duplicate prevention: second incident from the same alert conflicts.
  res = await request("/incidents", {
    method: "POST",
    body: JSON.stringify({ alertId: alertA.id }),
  }, adminToken);
  assertStatus(res.status, 409, "a second incident for the same alert returns 409", "incident duplicate prevention");

  // --- List + filters ---
  res = await request(`/incidents/${alertB.id}`, {}, adminToken); // wrong id -> 404
  assertStatus(res.status, 404, "incident ids are never the alert id (404)", "incident id mismatch");

  res = await request("/incidents", { method: "POST", body: JSON.stringify({ alertId: alertB.id }) }, adminToken);
  const incidentBId = (res.body as IncidentBody)?.data?.id;
  assertStatus(res.status, 201, "second incident created from the warning alert", "incident create #2");

  res = await request(`/incidents/${incidentAId}`, {}, adminToken);
  const byId = res.body as IncidentBody;
  if (res.status === 200 && byId?.data?.title === "Critical incident test alert") {
    ok("GET /incidents/:id returns the incident with its alert title");
  } else {
    fail("incident get by id", res);
  }

  res = await request("/incidents?status=investigating", {}, adminToken);
  const investigatingList = res.body as { data?: Array<{ id: string }> } | null;
  if (
    res.status === 200 &&
    investigatingList?.data?.some((i) => i.id === incidentAId) &&
    !investigatingList.data.some((i) => i.id === incidentBId)
  ) {
    ok("status=investigating filters incidents correctly");
  } else {
    fail("incident status filter", res);
  }

  res = await request("/incidents?priority=critical", {}, adminToken);
  const priorityList = res.body as { data?: Array<{ id: string }> } | null;
  if (
    res.status === 200 &&
    priorityList?.data?.some((i) => i.id === incidentAId) &&
    !priorityList.data.some((i) => i.id === incidentBId)
  ) {
    ok("priority=critical filters incidents by severity");

    res = await request("/incidents?search=Warning", {}, adminToken);
    const searchList = res.body as { data?: Array<{ id: string }> } | null;
    if (
      res.status === 200 &&
      searchList?.data?.some((i) => i.id === incidentBId) &&
      !searchList.data.some((i) => i.id === incidentAId)
    ) {
      ok("search=Warning narrows to the warning incident");
    } else {
      fail("incident search filter", res);
    }
  } else {
    fail("incident priority filter", res);
  }

  // --- Priority change ---
  res = await request(`/incidents/${incidentAId}/priority`, {
    method: "PATCH",
    body: JSON.stringify({ priority: "warning" }),
  }, adminToken);
  const priorityChanged = res.body as IncidentBody;
  if (res.status === 200 && priorityChanged?.data?.priority === "warning") {
    ok("priority can be changed on an open incident", "critical -> warning");

    res = await request(`/incidents/${incidentAId}/priority`, {
      method: "PATCH",
      body: JSON.stringify({ priority: "critical" }),
    }, adminToken);
    const priorityCritical = res.body as IncidentBody;
    if (res.status === 200 && priorityCritical?.data?.priority === "critical") {
      ok("priority can be raised back to critical", "warning -> critical");
    } else {
      fail("incident priority raise", res);
    }
  } else {
    fail("incident priority change", res);
  }

  // --- Assignment (with RBAC) ---
  res = await request(`/incidents/${incidentAId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigneeId: activeUser.id }),
  }, adminToken);
  const assigned = res.body as IncidentBody;
  if (
    res.status === 200 &&
    assigned?.data?.assignedToUserId === activeUser.id &&
    assigned?.data?.assignedToName === "Incident Assignee"
  ) {
    ok("assigning a user sets assignedToUserId and assignedToName");
  } else {
    fail("incident assignment", res);
  }

  res = await request(`/incidents/${incidentAId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigneeId: disabledUser.id }),
  }, adminToken);
  assertStatus(res.status, 422, "assigning a disabled user returns 422", "incident assign disabled");

  res = await request(`/incidents/${incidentAId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigneeId: randomUuid }),
  }, adminToken);
  assertStatus(res.status, 404, "assigning an unknown user returns 404", "incident assign unknown");

  res = await request(`/incidents?assignedTo=${activeUser.id}`, {}, adminToken);
  const assignedList = res.body as { data?: Array<{ id: string }> } | null;
  if (
    res.status === 200 &&
    assignedList?.data?.some((i) => i.id === incidentAId) &&
    !assignedList.data.some((i) => i.id === incidentBId)
  ) {
    ok("assignedTo=<user> filters to the incident assigned to that user", "assigned list filter");
  } else {
    fail("incident assignedTo filter", res);
  }

  res = await request(`/incidents/${incidentAId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigneeId: null }),
  }, adminToken);
  const unassigned = res.body as IncidentBody;
  if (res.status === 200 && unassigned?.data?.assignedToUserId == null) {
    ok("unassigning clears the assignee", "assigneeId=null works");
  } else {
    fail("incident unassignment", res);
  }

  res = await request(`/incidents?assignedTo=${activeUser.id}`, {}, adminToken);
  const afterUnassign = res.body as { data?: Array<{ id: string }> } | null;
  if (
    res.status === 200 &&
    afterUnassign?.data &&
    !afterUnassign.data.some((i) => i.id === incidentAId)
  ) {
    ok("the unassigned incident no longer appears in the assignee filter", "assignedTo filter after unassign");
  } else {
    fail("incident assignedTo filter after unassign", res);
  }

  // --- Notes ---
  res = await request(`/incidents/${incidentAId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "Initial investigation note" }),
  }, adminToken);
  const withNote = res.body as IncidentBody;
  if (
    res.status === 201 &&
    withNote?.data?.notes?.some((n) => (n as { body: string }).body === "Initial investigation note")
  ) {
    ok("adding a note stores it on the incident");
  } else {
    fail("incident note creation", res);
  }

  res = await request(`/incidents/${incidentAId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "   " }),
  }, adminToken);
  assertStatus(res.status, 400, "a blank note body is rejected with 400", "incident note validation");

  res = await request(`/incidents/${randomUuid}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: "note on unknown incident" }),
  }, adminToken);
  assertStatus(res.status, 404, "adding a note to an unknown incident returns 404", "incident note 404");

  // --- Resolution & reopen ---
  res = await request(`/incidents/${incidentAId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  }, adminToken);
  const resolved = res.body as IncidentBody;
  if (
    res.status === 200 &&
    resolved?.data?.status === "resolved" &&
    resolved?.data?.resolvedAt &&
    resolved?.data?.resolvedByName === "Admin User"
  ) {
    ok("resolving records resolvedAt and resolvedBy");
  } else {
    fail("incident resolution", res);
  }

  res = await request(`/incidents/${incidentAId}/assign`, {
    method: "PATCH",
    body: JSON.stringify({ assigneeId: activeUser.id }),
  }, adminToken);
  assertStatus(res.status, 422, "assigning a resolved incident returns 422", "incident assign resolved");

  res = await request(`/incidents/${incidentAId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "investigating" }),
  }, adminToken);
  assertStatus(res.status, 422, "resolved -> investigating is rejected", "incident resolved transition");

  res = await request(`/incidents/${incidentAId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "reopened" }),
  }, adminToken);
  assertStatus(res.status, 200, "resolved -> reopened is allowed", "incident reopen");
  const reopened = res.body as IncidentBody;
  if (reopened?.data?.status === "reopened") ok("reopened status is persisted");
  else fail("incident reopen persisted", res);

  res = await request(`/incidents/${incidentAId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "investigating" }),
  }, adminToken);
  assertStatus(res.status, 200, "reopened -> investigating is allowed", "incident re-investigate");

  res = await request(`/incidents/${incidentAId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "resolved" }),
  }, adminToken);
  assertStatus(res.status, 200, "reopened -> resolved is allowed (incident fully resolved)", "incident final resolve");

  // Activity timeline was recorded (status/assignment/notes).
  res = await request(`/incidents/${incidentAId}`, {}, adminToken);
  const activityBody = res.body as IncidentBody;
  const activity = activityBody?.data?.activity ?? [];
  const actions = new Set(activity.map((a) => a.action));
  if (
    activity.length >= 8 &&
    actions.has("opened") &&
    actions.has("status_changed") &&
    actions.has("assigned") &&
    actions.has("unassigned") &&
    actions.has("note_added") &&
    actions.has("priority_changed")
  ) {
    ok("incident activity timeline records opened/status/assignment/notes/priority");
  } else {
    fail("incident activity timeline", { count: activity.length, actions: [...actions] });
  }

  // --- RBAC: viewer can read but not manage ---
  if (viewerToken) {
    res = await request("/incidents", {}, viewerToken);
    assertStatus(res.status, 200, "viewer can list incidents (alerts.read)", "incident RBAC read");

    res = await request("/incidents", {
      method: "POST",
      body: JSON.stringify({ alertId: alertC.id }),
    }, viewerToken);
    assertStatus(res.status, 403, "viewer cannot create an incident (alerts.manage required)", "incident RBAC create");

    res = await request(`/incidents/${incidentBId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged" }),
    }, viewerToken);
    assertStatus(res.status, 403, "viewer cannot change incident status (alerts.manage required)", "incident RBAC status");

    res = await request(`/incidents/${incidentBId}/assign`, {
      method: "PATCH",
      body: JSON.stringify({ assigneeId: activeUser.id }),
    }, viewerToken);
    assertStatus(res.status, 403, "viewer cannot assign an incident (alerts.manage required)", "incident RBAC assign");
  } else {
    fail("viewer login", viewerLogin);
  }

  res = await request("/incidents/", { method: "POST", body: JSON.stringify({ alertId: alertC.id }) }, adminToken);
  assertStatus(res.status, 201, "admin-created incident from the third alert", "incident create #3");

  // --- Summary ---
  res = await request("/incidents/summary", {}, adminToken);
  const summary = res.body as { data?: { total: number; open: number; resolved: number; byStatus: Record<string, number> } } | null;
  if (
    res.status === 200 &&
    summary?.data &&
    summary.data.total >= 1 &&
    summary.data.open >= 1 &&
    summary.data.resolved >= 1 &&
    summary.data.byStatus &&
    typeof summary.data.byStatus.resolved === "number"
  ) {
    ok("incident summary aggregates open/resolved counts", `${summary.data.total} total`);
  } else {
    fail("incident summary", res);
  }

  // --- Audit trail records incident operations ---
  res = await request("/audit-logs?module=incidents&limit=50", {}, adminToken);
  const auditBody = res.body as { data?: Array<{ action: string; description: string }> } | null;
  const auditActions = new Set((auditBody?.data ?? []).map((a) => a.action));
  if (
    res.status === 200 &&
    auditActions.has("incident_created") &&
    auditActions.has("incident_status_changed") &&
    auditActions.has("incident_assigned") &&
    auditActions.has("incident_unassigned") &&
    auditActions.has("incident_note_added") &&
    auditActions.has("incident_resolved") &&
    auditActions.has("incident_reopened")
  ) {
    ok("incident operations are recorded in the audit log");
  } else {
    fail("incident audit trail", [...auditActions]);
  }

  console.log(`\nIncident API tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  await prisma.alert
    .deleteMany({ where: { id: { in: [alertA.id, alertB.id, alertC.id] } } })
    .catch(() => undefined);
  await prisma.detection
    .deleteMany({ where: { id: { in: [detA.id, detB.id, detC.id] } } })
    .catch(() => undefined);
  await prisma.camera.deleteMany({ where: { id: cameraId } }).catch(() => undefined);
  for (const userId of createdUserIds) {
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
  }
}

function assertStatus(actual: number, expected: number, name: string, detail: unknown) {
  if (actual === expected) ok(name, detail);
  else fail(name, { expected, actual });
}

run().finally(() => {
  if (server) killProcessTree(server);
  prisma.$disconnect().catch(() => undefined);
});