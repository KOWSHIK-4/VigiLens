import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma";

const TEST_PORT_BASE = 6331;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

const RUN_TAG = `${process.pid}`;
const ORG_A_ID = "00000000-0000-0000-0000-000000000001";

let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;

const roleName = `tv_scoped_${RUN_TAG}`;
const leadEmail = `tv-lead-${RUN_TAG}@vigilens.io`;

const createdTeamIds: string[] = [];
const createdCameraIds: string[] = [];
const createdDetectionIds: string[] = [];
const createdAlertIds: string[] = [];
const createdUserIds: string[] = [];

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

interface Fixture {
  teamA: string;
  teamB: string;
  cameraA: string;
  cameraB: string;
  detectionA: string;
  detectionB: string;
  alertA: string;
  alertB: string;
  leadId: string;
}

/** Seeds team-scoped fixtures inside the seeded tenant (org A). */
async function seedFixtures(): Promise<Fixture> {
  const teamA = await prisma.team.create({
    data: { name: `TVA ${RUN_TAG}`, description: "team A fixture", organizationId: ORG_A_ID },
  });
  const teamB = await prisma.team.create({
    data: { name: `TVB ${RUN_TAG}`, description: "team B fixture", organizationId: ORG_A_ID },
  });
  createdTeamIds.push(teamA.id, teamB.id);

  const cameraA = await prisma.camera.create({
    data: {
      name: `tv-camera-a-${RUN_TAG}`,
      url: `rtsp://team-a-${RUN_TAG}/stream`,
      organizationId: ORG_A_ID,
      teamId: teamA.id,
    },
  });
  const cameraB = await prisma.camera.create({
    data: {
      name: `tv-camera-b-${RUN_TAG}`,
      url: `rtsp://team-b-${RUN_TAG}/stream`,
      organizationId: ORG_A_ID,
      teamId: teamB.id,
    },
  });
  createdCameraIds.push(cameraA.id, cameraB.id);

  const detectionA = await prisma.detection.create({
    data: {
      cameraId: cameraA.id,
      teamId: teamA.id,
      label: `tv-detect-a-${RUN_TAG}`,
      confidence: 0.9,
      status: "critical",
      imageUrl: "",
      organizationId: ORG_A_ID,
    },
  });
  const detectionB = await prisma.detection.create({
    data: {
      cameraId: cameraB.id,
      teamId: teamB.id,
      label: `tv-detect-b-${RUN_TAG}`,
      confidence: 0.9,
      status: "critical",
      imageUrl: "",
      organizationId: ORG_A_ID,
    },
  });
  createdDetectionIds.push(detectionA.id, detectionB.id);

  const alertA = await prisma.alert.create({
    data: {
      detectionId: detectionA.id,
      severity: "critical",
      title: `tv-alert-a-${RUN_TAG}`,
      message: "team A fixture",
      organizationId: ORG_A_ID,
      teamId: teamA.id,
      isRead: false,
    },
  });
  const alertB = await prisma.alert.create({
    data: {
      detectionId: detectionB.id,
      severity: "critical",
      title: `tv-alert-b-${RUN_TAG}`,
      message: "team B fixture",
      organizationId: ORG_A_ID,
      teamId: teamB.id,
      isRead: false,
    },
  });
  createdAlertIds.push(alertA.id, alertB.id);

  const scopedRole = await prisma.role.upsert({
    where: { organizationId_name: { organizationId: ORG_A_ID, name: roleName } },
    update: {},
    create: {
      name: roleName,
      description: "team visibility scoped role",
      isSystem: false,
      organizationId: ORG_A_ID,
    },
  });
  const permKeys = [
    "cameras.read",
    "detections.read",
    "alerts.read",
    "analytics.read",
    "audit.read",
  ];
  const perms = await prisma.permission.findMany({ where: { key: { in: permKeys } } });
  await prisma.rolePermission.deleteMany({ where: { roleId: scopedRole.id } });
  await prisma.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: scopedRole.id, permissionId: p.id })),
  });

  const password = await bcrypt.hash("admin123", 12);
  const lead = await prisma.user.create({
    data: {
      email: leadEmail,
      name: "Team Visibility Lead",
      password,
      role: roleName,
      status: "active",
      organizationId: ORG_A_ID,
      teamId: teamA.id,
    },
  });
  createdUserIds.push(lead.id);

  await prisma.team.update({
    where: { id: teamA.id },
    data: { lead: { connect: { id: lead.id } } },
  });

  return {
    teamA: teamA.id,
    teamB: teamB.id,
    cameraA: cameraA.id,
    cameraB: cameraB.id,
    detectionA: detectionA.id,
    detectionB: detectionB.id,
    alertA: alertA.id,
    alertB: alertB.id,
    leadId: lead.id,
  };
}

async function cleanupFixtures() {
  if (createdAlertIds.length > 0) {
    await prisma.alert.deleteMany({ where: { id: { in: createdAlertIds } } }).catch(() => null);
  }
  if (createdDetectionIds.length > 0) {
    await prisma.detection.deleteMany({ where: { id: { in: createdDetectionIds } } }).catch(() => null);
  }
  if (createdUserIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: createdUserIds } },
      data: { teamId: null },
    }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => null);
  }
  if (createdCameraIds.length > 0) {
    await prisma.camera.deleteMany({ where: { id: { in: createdCameraIds } } }).catch(() => null);
  }
  await prisma.role.deleteMany({ where: { name: roleName } }).catch(() => null);
  if (createdTeamIds.length > 0) {
    await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } }).catch(() => null);
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

  let fixture: Fixture;
  try {
    fixture = await seedFixtures();
    ok("seeded team visibility fixtures (2 teams, 2 cameras, 2 detections, 2 alerts, scoped role + lead)");
  } catch (err) {
    fail("seed fixtures", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for team visibility tests...`);
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
    return (res.body as { data: { token: string } }).data;
  };

  const viewer = await login("viewer@vigilens.io");
  const lead = await login(leadEmail);
  if (!viewer || !lead) return;
  ok("logins for viewer (org-wide) and team-lead actor");
  const tokenView = viewer.token;
  const tokenLead = lead.token;

  // 1. Forced own-team scope: a member without teams.read sees only their team.
  const listCam = await request("/cameras?page=1&limit=50", {}, tokenLead);
  const cams = (listCam.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (
    listCam.status === 200 &&
    cams.some((c) => c.id === fixture.cameraA) &&
    !cams.some((c) => c.id === fixture.cameraB)
  )
    ok("camera list forces own-team scope (team A only, no team B)");
  else fail("camera list own-team scope", { status: listCam.status, cams });

  // 2. Explicit own-team filter passes through.
  const ownTeam = await request(`/cameras?teamId=${fixture.teamA}`, {}, tokenLead);
  const ownCams = (ownTeam.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (ownTeam.status === 200 && ownCams.some((c) => c.id === fixture.cameraA))
    ok("camera list accepts own teamId filter");
  else fail("camera list own teamId filter", ownTeam);

  // 3. Another team in the same org is rejected with 403.
  const otherTeam = await request(`/cameras?teamId=${fixture.teamB}`, {}, tokenLead);
  if (otherTeam.status === 403) ok("camera list rejects other-team teamId (403)");
  else fail("camera list other-team teamId", otherTeam);

  // 4. A teamId that does not exist in the tenant is rejected with 404.
  const randomTeam = await request("/cameras?teamId=11111111-1111-4111-8111-111111111111", {}, tokenLead);
  if (randomTeam.status === 404) ok("camera list rejects unknown teamId (404)");
  else fail("camera list unknown teamId", randomTeam);

  // 5. Detection list is camera-scoped to the actor's team.
  const listDet = await request("/detections?page=1&limit=50", {}, tokenLead);
  const dets = (listDet.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (
    listDet.status === 200 &&
    dets.some((d) => d.id === fixture.detectionA) &&
    !dets.some((d) => d.id === fixture.detectionB)
  )
    ok("detection list includes own-team detection and excludes other-team detection");
  else fail("detection list scope", { status: listDet.status, dets });

  // 6. Alerts are scoped the same way.
  const listAlert = await request("/alerts?page=1&limit=50", {}, tokenLead);
  const alerts = (listAlert.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (
    listAlert.status === 200 &&
    alerts.some((a) => a.id === fixture.alertA) &&
    !alerts.some((a) => a.id === fixture.alertB)
  )
    ok("alert list includes own-team alert and excludes other-team alert");
  else fail("alert list scope", { status: listAlert.status, alerts });

  const otherTeamAlert = await request(`/alerts?teamId=${fixture.teamB}`, {}, tokenLead);
  if (otherTeamAlert.status === 403) ok("alert list rejects other-team teamId (403)");
  else fail("alert list other-team teamId", otherTeamAlert);

  const unread = await request("/alerts/unread-count", {}, tokenLead);
  if (unread.status === 200) ok("unread-count reachable under own-team scope");
  else fail("unread-count", unread);

  // 7. Analytics overview honors the team scope; other-team teamId is rejected.
  const otherTeamAna = await request(`/analytics/overview?period=30&teamId=${fixture.teamB}`, {}, tokenLead);
  if (otherTeamAna.status === 403) ok("analytics rejects other-team teamId (403)");
  else fail("analytics other-team teamId", otherTeamAna);

  const ana = await request("/analytics/overview?period=30", {}, tokenLead);
  const anaData = (ana.body as { data?: { totalDetections?: number } })?.data;
  if (ana.status === 200 && anaData?.totalDetections === 1)
    ok("analytics overview counts only the actor's team detections");
  else fail("analytics overview own-team count", ana);

  // 8. Audit logs respect the same visibility for filtered listing.
  const auditScoped = await request("/audit-logs?page=1&limit=25", {}, tokenLead);
  const auditRows = (auditScoped.body as { data?: Array<{ metadata?: { teamId?: string } }> })?.data ?? [];
  if (auditScoped.status === 200) ok("audit log list reachable under own-team scope");
  else fail("audit log list", auditScoped);
  if (Array.isArray(auditRows) && auditRows.length > 0) {
    const scoped = auditRows.every((r) => r.metadata?.teamId === fixture.teamA);
    if (scoped) ok("audit log rows are all scoped to the actor's team");
    else fail("audit log scope", auditRows);
  } else {
    ok("audit log list empty and safe under own-team scope");
  }

  // 9. An org-wide (teams.read) viewer can still query the other team.
  const viewerOther = await request(`/cameras?teamId=${fixture.teamB}`, {}, tokenView);
  const viewerCams = (viewerOther.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (viewerOther.status === 200 && viewerCams.some((c) => c.id === fixture.cameraB))
    ok("teams.read viewer may query the other team (org-wide scope)");
  else fail("viewer other-team query", viewerOther);

  // 10. Team-lead scope: lead manages their own team but not another.
  const leadOwn = await request(
    `/teams/${fixture.teamA}`,
    { method: "PATCH", body: JSON.stringify({ description: "lead updated" }) },
    tokenLead,
  );
  if (leadOwn.status === 200) ok("team lead can update their own team");
  else fail("team lead own-team update", leadOwn);

  const leadOther = await request(
    `/teams/${fixture.teamB}`,
    { method: "PATCH", body: JSON.stringify({ description: "nope" }) },
    tokenLead,
  );
  if (leadOther.status === 403) ok("team lead cannot update another team (403)");
  else fail("team lead other-team update", leadOther);

  // 11. Membership check: a lead moved out of their team loses lead powers.
  await prisma.user.update({
    where: { id: fixture.leadId },
    data: { teamId: fixture.teamB },
  });
  const staleLead = await request(
    `/teams/${fixture.teamA}`,
    { method: "PATCH", body: JSON.stringify({ description: "stale lead" }) },
    tokenLead,
  );
  await prisma.user.update({
    where: { id: fixture.leadId },
    data: { teamId: fixture.teamA },
  });
  if (staleLead.status === 403) ok("non-member lead loses manage rights (membership check)");
  else fail("non-member stale lead", staleLead);

  if (failed > 0) {
    console.log(`\n${failed} team visibility test(s) FAILED, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\nTeam visibility: ${passed} passed, 0 failed`);
  }
}

run()
  .catch((err) => {
    console.error("team visibility test run crashed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) killProcessTree(server);
    await cleanupFixtures();
    await prisma.$disconnect();
  });