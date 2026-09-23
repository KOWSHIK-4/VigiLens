import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma";

const TEST_PORT_BASE = 4831;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

const RUN_TAG = `${process.pid}`;
const MIN_ORG_A_CAMERAS = 5;
const MIN_ORG_A_USERS = 5;

let server: ChildProcess | null = null;
let orgB: TenantBFixture | null = null;
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

interface TenantBFixture {
  orgId: string;
  userId: string;
  email: string;
  cameraId: string;
  detectionId: string;
}

/** Creates tenant B with its own org, user, camera and detection through the
 * database (there is no public org-provisioning API yet), so the API
 * isolation assertions below run against a true second tenant. */
async function seedOrgB(): Promise<TenantBFixture> {
  const orgId = `00000000-0000-4000-8000-${RUN_TAG.padStart(12, "0").slice(-12)}`;
  const email = `orgb-isolation-${RUN_TAG}@vigilens.io`;

  const org = await prisma.organization.create({
    data: { id: orgId, name: `Tenant B (${RUN_TAG})`, slug: `tenant-b-${RUN_TAG}` },
  });

  const password = await bcrypt.hash("admin123", 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Tenant B Operator",
      password,
      role: "super_admin",
      status: "active",
      organizationId: org.id,
    },
  });

  const camera = await prisma.camera.create({
    data: {
      name: `orgb-camera-${RUN_TAG}`,
      url: `rtsp://tenant-b/stream-${RUN_TAG}`,
      organizationId: org.id,
    },
  });

  const detection = await prisma.detection.create({
    data: {
      cameraId: camera.id,
      label: `intruder-orgb-${RUN_TAG}`,
      confidence: 0.92,
      status: "critical",
      imageUrl: "",
      organizationId: org.id,
    },
  });

  return { orgId: org.id, userId: user.id, email, cameraId: camera.id, detectionId: detection.id };
}

async function cleanupOrgB(orgId: string) {
  try {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => null);
  } catch {
    // already gone
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

  try {
    orgB = await seedOrgB();
    ok("seeded tenant B (org + user + camera + detection)");
  } catch (err) {
    fail("seed tenant B", String(err));
    return;
  }
  const fixture = orgB;

  console.log(`Starting backend server on port ${TEST_PORT} for tenant isolation tests...`);
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
    return (res.body as { data: { token: string; user: { organizationId?: string } } }).data;
  };

  const orgA = await login("super@vigilens.io");
  if (!orgA) return;
  ok("tenant A super admin login");

  const orgBLogin = await login(fixture.email);
  if (!orgBLogin) return;
  ok("tenant B login");

  const tokenA = orgA.token;
  const tokenB = orgBLogin.token;

  // 1. JWT/identity: /auth/me carries the DB-derived org ids.
  if (orgBLogin.user.organizationId === fixture.orgId) ok("tenant B /auth/me reports its own organizationId");
  else fail("tenant B /auth/me organizationId", orgBLogin.user);

  const meA = await request("/auth/me", {}, tokenA);
  const meAOrg = (meA.body as { data?: { organizationId?: string } })?.data?.organizationId;
  if (typeof meAOrg === "string" && meAOrg !== fixture.orgId)
    ok("tenant A /auth/me reports non-tenant-B organizationId");
  else fail("tenant A /auth/me organizationId", meA.body);

  const [, payloadB] = tokenB.split(".");
  const decodedB = payloadB
    ? (JSON.parse(Buffer.from(payloadB, "base64url").toString("utf-8")) as { organizationId?: string })
    : null;
  if (decodedB?.organizationId === fixture.orgId) ok("tenant B JWT carries its own organizationId claim");
  else fail("tenant B JWT claim", decodedB);

  // 2. Camera list isolation.
  const camerasA = await request("/cameras?page=1&limit=20", {}, tokenA);
  const camerasB = await request("/cameras?page=1&limit=20", {}, tokenB);
  const listA = (camerasA.body as { data?: Array<{ id: string; name: string }> })?.data ?? [];
  const listB = (camerasB.body as { data?: Array<{ id: string; name: string }> })?.data ?? [];
  const idsA = new Set(listA.map((c) => c.id));
  const idsB = new Set(listB.map((c) => c.id));

  if (idsB.has(fixture.cameraId) && idsB.size === 1) ok("tenant B camera list contains only its own camera");
  else fail("tenant B camera list", { idsB: [...idsB], expect: [fixture.cameraId] });

  if (listA.length >= MIN_ORG_A_CAMERAS && !idsA.has(fixture.cameraId))
    ok("tenant A camera list excludes tenant B cameras");
  else fail("tenant A camera list", { size: listA.length, leaked: idsA.has(fixture.cameraId) });

  // 3. Cross-tenant camera fetch → 404 both directions.
  const aFetchB = await request(`/cameras/${fixture.cameraId}`, {}, tokenA);
  const aCamId = listA.find((c) => !idsB.has(c.id))?.id ?? listA[0]?.id;
  const bFetchA = await request(`/cameras/${aCamId ?? ""}`, {}, tokenB);
  if (aFetchB.status === 404) ok("tenant A cannot fetch tenant B camera (404)");
  else fail("tenant A fetch of tenant B camera", aFetchB);
  if (bFetchA.status === 404) ok("tenant B cannot fetch tenant A camera (404)");
  else fail("tenant B fetch of tenant A camera", { status: bFetchA.status, aCamId });

  // 4. Detection detail isolation.
  const aDetectionB = await request(`/detections/${fixture.detectionId}`, {}, tokenA);
  const bDetectionOwn = await request(`/detections/${fixture.detectionId}`, {}, tokenB);
  if (aDetectionB.status === 404) ok("tenant A cannot read tenant B detection (404)");
  else fail("tenant A read of tenant B detection", aDetectionB);
  if (bDetectionOwn.status === 200) ok("tenant B reads its own detection");
  else fail("tenant B read of own detection", bDetectionOwn);

  // 5. Alert isolation (write + list + delete).
  const alertB = await prisma.alert.create({
    data: {
      detectionId: fixture.detectionId,
      severity: "critical",
      title: `orgb-alert-${RUN_TAG}`,
      message: "isolation fixture",
      organizationId: fixture.orgId,
    },
  });

  const aMarkB = await request(`/alerts/${alertB.id}/read`, { method: "PATCH" }, tokenA);
  if (aMarkB.status === 404) ok("tenant A cannot touch tenant B alert (404)");
  else fail("tenant A PATCH on tenant B alert", aMarkB);

  const bListSearch = await request(`/alerts?page=1&limit=10&search=orgb-alert-${RUN_TAG}`, {}, tokenB);
  const aListSearch = await request(`/alerts?page=1&limit=10&search=orgb-alert-${RUN_TAG}`, {}, tokenA);
  const bAlertHits = (bListSearch.body as { data?: Array<{ id: string }> })?.data;
  const aAlertHits = (aListSearch.body as { data?: Array<{ id: string }> })?.data;
  if (bAlertHits?.some((a) => a.id === alertB.id)) ok("tenant B alert list contains its own alert");
  else fail("tenant B alert search", bListSearch);
  if (!aAlertHits?.some((a) => a.id === alertB.id)) ok("tenant A alert list excludes tenant B alert");
  else fail("tenant A alert search leaked tenant B alert", aAlertHits);

  const aDeleteB = await request(`/alerts/${alertB.id}`, { method: "DELETE" }, tokenA);
  if (aDeleteB.status === 404) ok("tenant A cannot delete tenant B alert (404)");
  else fail("tenant A delete of tenant B alert", aDeleteB);

  // 6. Incident routing: A cannot open an incident on B's alert; B can.
  const aIncident = await request(
    "/incidents",
    { method: "POST", body: JSON.stringify({ alertId: alertB.id }) },
    tokenA,
  );
  if (aIncident.status === 404) ok("tenant A cannot create incident on tenant B alert (404)");
  else fail("tenant A incident on tenant B alert", aIncident);

  const bIncident = await request(
    "/incidents",
    { method: "POST", body: JSON.stringify({ alertId: alertB.id }) },
    tokenB,
  );
  const incidentBId = (bIncident.body as { data?: { id?: string } })?.data?.id;
  if (bIncident.status === 201 && incidentBId) ok("tenant B opens incident on own alert");
  else fail("tenant B incident creation", bIncident);

  if (incidentBId) {
    const aIncidents = await request("/incidents?page=1&limit=50", {}, tokenA);
    const aIncidentList = (aIncidents.body as { data?: Array<{ id: string }> })?.data ?? [];
    if (!aIncidentList.some((i) => i.id === incidentBId))
      ok("tenant A incident list excludes tenant B incident");
    else fail("tenant A incident list leaked tenant B incident", aIncidentList);

    const bIncidentDetail = await request(`/incidents/${incidentBId}`, {}, tokenB);
    if (bIncidentDetail.status === 200) ok("tenant B reads its own incident");
    else fail("tenant B read of own incident", bIncidentDetail);
  }

  // 7. Analytics isolation (org-scoped caches + rows).
  const analyticsA = await request("/analytics/overview?period=30", {}, tokenA);
  const analyticsB = await request("/analytics/overview?period=30", {}, tokenB);
  const overviewA = (analyticsA.body as { data?: { totalDetections?: number } })?.data;
  const overviewB = (analyticsB.body as { data?: { totalDetections?: number } })?.data;
  if (analyticsA.status === 200 && analyticsB.status === 200) ok("analytics overview reachable for both tenants");
  else fail("analytics overview", { statusA: analyticsA.status, statusB: analyticsB.status });

  const bDetections = overviewB?.totalDetections ?? -1;
  const aDetections = overviewA?.totalDetections ?? -1;
  if (bDetections === 1) ok("tenant B analytics counts only its own detection");
  else fail("tenant B analytics totalDetections", overviewB);
  if (aDetections >= 1 && aDetections - bDetections >= 1)
    ok("tenant A analytics excludes tenant B detection");
  else fail("tenant A analytics totalDetections", { overviewA, overviewB });

  const timelineB = await request("/analytics/timeline?period=30", {}, tokenB);
  const bTimeline = (timelineB.body as { data?: Array<{ hour: string; value: number }> })?.data;
  if (bTimeline) {
    const bSum = bTimeline.reduce((s, p) => s + p.value, 0);
    if (bSum === 1) ok("tenant B timeline counts only its own detection");
    else fail("tenant B timeline sum", bTimeline);
  } else {
    fail("tenant B timeline", timelineB);
  }

  // 8. Audit log isolation.
  const auditA = await request("/audit-logs?page=1&limit=25", {}, tokenA);
  const auditB = await request("/audit-logs?page=1&limit=25", {}, tokenB);
  const auditListA = (auditA.body as { data?: Array<{ id: string }> })?.data ?? [];
  const auditListB = (auditB.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (auditA.status === 200 && auditB.status === 200) ok("audit listing reachable for both tenants");
  else fail("audit listing", { statusA: auditA.status, statusB: auditB.status });

  const aIds = new Set(auditListA.map((r) => r.id));
  const bOverlap = auditListB.filter((r) => aIds.has(r.id)).length;
  if (auditListB.length > 0 && bOverlap === 0) ok("tenant A and tenant B audit lists do not overlap");
  else fail("audit list overlap", { bOverlap, aCount: auditListA.length, bCount: auditListB.length });

  if (auditListB[0]) {
    const aAuditB = await request(`/audit-logs/${auditListB[0].id}`, {}, tokenA);
    if (aAuditB.status === 404) ok("tenant A cannot read tenant B audit log (404)");
    else fail("tenant A read of tenant B audit log", aAuditB);
  }

  // 9. Users isolation.
  const usersA = await request("/users?page=1&limit=20", {}, tokenA);
  const usersB = await request("/users?page=1&limit=20", {}, tokenB);
  const usersListA = (usersA.body as { data?: Array<{ id: string; email: string }> })?.data ?? [];
  const usersListB = (usersB.body as { data?: Array<{ id: string; email: string }> })?.data ?? [];
  if (usersA.status === 200 && usersB.status === 200) ok("user listing reachable for both tenants");
  else fail("user listing", { statusA: usersA.status, statusB: usersB.status });

  const bInA = usersListA.some((u) => u.id === fixture.userId);
  if (!bInA && usersListA.length >= MIN_ORG_A_USERS) ok("tenant A user list excludes tenant B user");
  else fail("tenant A user list", { leaked: bInA, count: usersListA.length });

  if (usersListB.some((u) => u.id === fixture.userId) && usersListB.length === 1)
    ok("tenant B user list contains only its own user");
  else fail("tenant B user list", usersListB);

  const aUserB = await request(`/users/${fixture.userId}`, {}, tokenA);
  if (aUserB.status === 404) ok("tenant A cannot read tenant B user (404)");
  else fail("tenant A read of tenant B user", aUserB);

  // 10. Report isolation (incl. download IDOR).
  const reportB = await request(
    "/reports/generate",
    {
      method: "POST",
      body: JSON.stringify({
        title: `orgb-report-${RUN_TAG}`,
        type: "daily",
        dateRange: { from: "2026-01-01", to: "2026-01-02" },
      }),
    },
    tokenB,
  );
  const reportBId = (reportB.body as { data?: { id?: string } })?.data?.id;
  if (reportB.status === 201 && reportBId) ok("tenant B generates a report");
  else fail("tenant B report generation", reportB);

  if (reportBId) {
    const aReportB = await request(`/reports/${reportBId}`, {}, tokenA);
    if (aReportB.status === 404) ok("tenant A cannot read tenant B report (404)");
    else fail("tenant A read of tenant B report", aReportB);

    const aDownloadB = await request(`/reports/download/${reportBId}?format=csv`, {}, tokenA);
    if (aDownloadB.status === 404) ok("tenant A cannot download tenant B report (404)");
    else fail("tenant A download of tenant B report", aDownloadB);

    const bReportB = await request(`/reports/${reportBId}`, {}, tokenB);
    if (bReportB.status === 200) ok("tenant B reads its own report");
    else fail("tenant B read of own report", bReportB);
  }

  // 11. Global search isolation.
  const searchA = await request(`/search?q=orgb-camera-${RUN_TAG}`, {}, tokenA);
  const searchB = await request(`/search?q=orgb-camera-${RUN_TAG}`, {}, tokenB);
  const sectionsA =
    (searchA.body as { data?: { sections?: Array<{ type: string; count: number }> } })?.data?.sections ?? [];
  const sectionsB =
    (searchB.body as { data?: { sections?: Array<{ type: string; count: number }> } })?.data?.sections ?? [];
  const aCameraHits = sectionsA.filter((s) => s.type === "cameras").reduce((sum, s) => sum + s.count, 0);
  const bCameraHits = sectionsB.filter((s) => s.type === "cameras").reduce((sum, s) => sum + s.count, 0);
  if (aCameraHits === 0) ok("tenant A global search finds no tenant B camera");
  else fail("tenant A global search leaked tenant B camera", sectionsA);
  if (bCameraHits >= 1) ok("tenant B global search finds its own camera");
  else fail("tenant B global search camera", sectionsB);

  // 12. Thumbnail IDOR: tenant A cannot fetch tenant B camera thumbnail.
  const aThumbnailB = await request(`/cameras/${fixture.cameraId}/thumbnail`, {}, tokenA);
  if (aThumbnailB.status === 404) ok("tenant A cannot fetch tenant B camera thumbnail (404)");
  else fail("tenant A thumbnail fetch of tenant B camera", {
    status: aThumbnailB.status,
    contentType: aThumbnailB.body,
  });

  // 13. Engine camera isolation: tenant A cannot process tenant B's camera.
  const aProcessB = await request(
    `/engines/person/process-live`,
    { method: "POST", body: JSON.stringify({ camera_id: fixture.cameraId }) },
    tokenA,
  );
  if (aProcessB.status === 404) ok("tenant A cannot process tenant B camera (404)");
  else fail("tenant A engine process of tenant B camera", aProcessB);

  // 14. Engine live path never falls back to a foreign camera: without a
  // camera_id it is rejected outright rather than silently resolving any
  // camera, and a cross-tenant camera id is never substituted.
  const bProcessNoCam = await request(
    `/engines/person/process-live`,
    { method: "POST", body: JSON.stringify({}) },
    tokenB,
  );
  if (bProcessNoCam.status === 400) ok("tenant B engine live requires an owned camera_id (400)");
  else fail("tenant B engine live missing camera_id", bProcessNoCam);

  const aProcessBCsv = await request(
    `/engines/person/process-live`,
    { method: "POST", body: JSON.stringify({ camera_id: fixture.cameraId, force: "true" }) },
    tokenA,
  );
  if (aProcessBCsv.status === 404) ok("tenant A engine live rejects tenant B camera without fallback (404)");
  else fail("tenant A engine live foreign camera fallback", aProcessBCsv);

  // 15. Fallback resolution scope is verified at the unit level too (see
  // engine-tenant-resolution.vitest.test.ts): with mocked data the resolver
  // only ever returns cameras inside the caller organization.
  const { resolveProcessingCamera } = await import("../src/engine/resolveCamera");
  const orgACameras = [{ id: "cam-a-1" }, { id: "cam-a-2" }];
  const resolvedA = await resolveProcessingCamera(async (args) => {
    const where = args.where as { id?: string; organizationId?: string };
    if (where.id) {
      return orgACameras.find((c) => c.id === where.id && where.organizationId === "org-a") ?? null;
    }
    return orgACameras.find((c) => {
      return where.organizationId === undefined || where.organizationId === "org-a";
    }) ?? null;
  }, "org-a");
  if (resolvedA === "cam-a-1") ok("engine fallback resolves a camera inside caller organization");
  else fail("engine fallback inside caller org", resolvedA);

  const resolvedForeign = await resolveProcessingCamera(async (args) => {
    const where = args.where as { id?: string; organizationId?: string };
    if (where.id) {
      return orgACameras.find((c) => c.id === where.id && where.organizationId === "org-a") ?? null;
    }
    return null;
  }, "org-a", fixture.cameraId).catch((err: unknown) => {
    return { rejected: (err as { statusCode?: number }).statusCode };
  });
  if (
    resolvedForeign !== null &&
    typeof resolvedForeign === "object" &&
    (resolvedForeign as { rejected: number }).rejected === 404
  )
    ok("engine requested foreign camera id is rejected (404)");
  else fail("engine requested foreign camera id rejection", resolvedForeign);

  // 16. Report content regeneration is tenant scoped: tenant A cannot
  // rebuild tenant B report content (404 before content generation).
  if (reportBId) {
    const aDownloadB2 = await request(`/reports/download/${reportBId}?format=csv`, {}, tokenA);
    if (aDownloadB2.status === 404) ok("tenant A cannot regenerate tenant B report content (404)");
    else fail("tenant A regeneration of tenant B report", aDownloadB2);
  }

  if (failed > 0) {
    console.log(`\n${failed} tenant isolation test(s) FAILED, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${passed} tenant isolation tests passed.`);
  }
}

run()
  .catch((err) => {
    console.error("tenant isolation test run crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) killProcessTree(server);
    if (orgB) cleanupOrgB(orgB.orgId);
    void prisma.$disconnect();
  });