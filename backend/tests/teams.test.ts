import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma";

const TEST_PORT_BASE = 5831;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

const RUN_TAG = `${process.pid}`;

let server: ChildProcess | null = null;
let orgB: OrgBFixture | null = null;
const createdTeamIds: string[] = [];
const createdUserIds: string[] = [];
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

interface OrgBFixture {
  orgId: string;
  userId: string;
  email: string;
}

async function seedOrgB(): Promise<OrgBFixture> {
  const orgId = `00000000-0000-4000-8000-${RUN_TAG.padStart(12, "0").slice(-12)}`;
  const email = `orgb-teams-${RUN_TAG}@vigilens.io`;

  const org = await prisma.organization.create({
    data: { id: orgId, name: `Tenant B Teams (${RUN_TAG})`, slug: `tenant-b-teams-${RUN_TAG}` },
  });

  const password = await bcrypt.hash("admin123", 12);
  const user = await prisma.user.create({
    data: {
      email,
      name: "Tenant B Teams Admin",
      password,
      role: "super_admin",
      status: "active",
      organizationId: org.id,
    },
  });

  return { orgId: org.id, userId: user.id, email };
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
    ok("seeded tenant B (org + super_admin user)");
  } catch (err) {
    fail("seed tenant B", String(err));
    return;
  }
  const fixture = orgB;

  console.log(`Starting backend server on port ${TEST_PORT} for team tests...`);
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

  const orgA = await login("super@vigilens.io");
  const operator = await login("operator@vigilens.io");
  const viewer = await login("viewer@vigilens.io");
  const orgBLogin = await login(fixture.email);
  if (!orgA || !operator || !viewer || !orgBLogin) return;
  ok("logins for org A (super/operator/viewer) and tenant B");

  const tokenA = orgA.token;
  const tokenOp = operator.token;
  const tokenView = viewer.token;
  const tokenB = orgBLogin.token;

  // 1. Team CRUD in org A.
  const teamName = `SOC North ${RUN_TAG}`;
  const create = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: teamName, description: "First line" }) },
    tokenA,
  );
  const teamId = (create.body as { data?: { id?: string } })?.data?.id;
  if (create.status === 201 && teamId) {
    ok("org A super admin creates a team");
    createdTeamIds.push(teamId);
  } else {
    fail("team creation", create);
    return;
  }

  // 2. Duplicate name within org → 409.
  const dup = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: teamName }) },
    tokenA,
  );
  if (dup.status === 409) ok("duplicate team name returns 409");
  else fail("duplicate team name", dup);

  // 3. List + search + pagination shape.
  const list = await request("/teams?page=1&limit=20", {}, tokenA);
  const listData = (list.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (
    list.status === 200 &&
    typeof (list.body as { total?: number }).total === "number" &&
    listData.some((t) => t.id === teamId)
  ) {
    ok("team list returns own team with pagination fields");
  } else {
    fail("team list", list.body);
  }

  const searchRes = await request(`/teams?search=${encodeURIComponent(teamName)}`, {}, tokenA);
  const searchHits = (searchRes.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (searchRes.status === 200 && searchHits.some((t) => t.id === teamId)) {
    ok("team search finds the team by name");
  } else {
    fail("team search", searchRes.body);
  }

  // 4. Fetch + update.
  const getOne = await request(`/teams/${teamId}`, {}, tokenA);
  if (getOne.status === 200) ok("team fetch by id");
  else fail("team fetch", getOne);

  const patch = await request(
    `/teams/${teamId}`,
    { method: "PATCH", body: JSON.stringify({ description: "Updated description" }) },
    tokenA,
  );
  const patchedDesc = (patch.body as { data?: { description?: string } })?.data?.description;
  if (patch.status === 200 && patchedDesc === "Updated description") ok("team update persists description");
  else fail("team update", patch);

  // 5. Assignment RPC: assign org A operator to the team.
  const opUser = await request("/users?search=operator%40vigilens.io", {}, tokenA);
  const opId = (opUser.body as { data?: Array<{ id: string }> })?.data?.[0]?.id;
  if (!opId) {
    fail("resolve operator user id", opUser.body);
    return;
  }

  const assign = await request(
    `/teams/${teamId}/members`,
    { method: "POST", body: JSON.stringify({ userId: opId }) },
    tokenA,
  );
  if (assign.status === 200) ok("team member assigned (POST /teams/:id/members)");
  else fail("team member assign", assign);

  const opAfter = await request(`/users/${opId}`, {}, tokenA);
  const opTeamId = (opAfter.body as { data?: { teamId?: string } })?.data?.teamId;
  if (opTeamId === teamId) ok("user record reflects teamId after assignment");
  else fail("user teamId after assignment", opAfter.body);

  const teamDetail = await request(`/teams/${teamId}`, {}, tokenA);
  const memberCount =
    (teamDetail.body as { data?: { _count?: { members?: number } } })?.data?._count?.members ?? -1;
  if (memberCount === 1) ok("team member count is 1");
  else fail("team member count", teamDetail.body);

  // 6. Assignment RPC: remove member.
  const removeMember = await request(
    `/teams/${teamId}/members/${opId}`,
    { method: "DELETE" },
    tokenA,
  );
  if (removeMember.status === 200) ok("team member removed (DELETE /teams/:id/members/:userId)");
  else fail("team member remove", removeMember);

  const opAfterRemove = await request(`/users/${opId}`, {}, tokenA);
  const opTeamAfter = (opAfterRemove.body as { data?: { teamId?: string | null } })?.data?.teamId;
  if (opTeamAfter === null) ok("user teamId nulled after removal");
  else fail("user teamId after removal", opAfterRemove.body);

  // 7. Deleting a team soft-detaches members (onDelete SetNull).
  const tempTeam = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: `Temp Team ${RUN_TAG}` }) },
    tokenA,
  );
  const tempTeamId = (tempTeam.body as { data?: { id?: string } })?.data?.id;
  if (tempTeamId) createdTeamIds.push(tempTeamId);
  await request(
    `/teams/${tempTeamId}/members`,
    { method: "POST", body: JSON.stringify({ userId: opId }) },
    tokenA,
  );
  const deleteTemp = await request(`/teams/${tempTeamId}`, { method: "DELETE" }, tokenA);
  if (deleteTemp.status === 200) ok("team deleted");
  else fail("team delete", deleteTemp);

  const opAfterTeamDelete = await request(`/users/${opId}`, {}, tokenA);
  const opTeamAfterDelete = (opAfterTeamDelete.body as { data?: { teamId?: string | null } })?.data?.teamId;
  if (opTeamAfterDelete === null) ok("deleting a team nulls member teamId (SetNull)");
  else fail("member teamId after team delete", opAfterTeamDelete.body);

  // 8. Tenant B creates and sees only its own teams.
  const orgBTeamName = `OrgB Ops ${RUN_TAG}`;
  const orgBTeam = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: orgBTeamName }) },
    tokenB,
  );
  const orgBTeamId = (orgBTeam.body as { data?: { id?: string } })?.data?.id;
  if (orgBTeam.status === 201 && orgBTeamId) {
    ok("tenant B creates its own team");
    createdTeamIds.push(orgBTeamId);
  } else {
    fail("tenant B team creation", orgBTeam);
    return;
  }

  const orgASearch = await request(`/teams?search=${encodeURIComponent(orgBTeamName)}`, {}, tokenA);
  const orgAHits = (orgASearch.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (orgASearch.status === 200 && orgAHits.length === 0)
    ok("tenant A search does not see tenant B team");
  else fail("tenant A sees tenant B team", orgASearch.body);

  const orgBList = await request("/teams?page=1&limit=20", {}, tokenB);
  const orgBListData = (orgBList.body as { data?: Array<{ id: string }> })?.data ?? [];
  if (orgBListData.length === 1 && orgBListData[0].id === orgBTeamId)
    ok("tenant B team list contains only its own team");
  else fail("tenant B team list", orgBList.body);

  const aFetchBTeam = await request(`/teams/${orgBTeamId}`, {}, tokenA);
  if (aFetchBTeam.status === 404) ok("tenant A cannot fetch tenant B team (404)");
  else fail("tenant A fetch of tenant B team", aFetchBTeam);

  // 9. Cross-tenant assignment guards.
  const crossAssign = await request(
    `/teams/${orgBTeamId}/members`,
    { method: "POST", body: JSON.stringify({ userId: opId }) },
    tokenB,
  );
  if (crossAssign.status === 404)
    ok("tenant B cannot assign an org A user to its team (404)");
  else fail("tenant B assigning org A user", crossAssign);

  const crossAssign2 = await request(
    `/teams/${teamId}/members`,
    { method: "POST", body: JSON.stringify({ userId: fixture.userId }) },
    tokenA,
  );
  if (crossAssign2.status === 404)
    ok("tenant A cannot assign a tenant B user to its team (404)");
  else fail("tenant A assigning tenant B user", crossAssign2);

  const aDeleteBTeam = await request(`/teams/${orgBTeamId}`, { method: "DELETE" }, tokenA);
  if (aDeleteBTeam.status === 404) ok("tenant A cannot delete tenant B team (404)");
  else fail("tenant A delete of tenant B team", aDeleteBTeam);

  // 10. Permission gates: operator/viewer can read, cannot manage.
  const opList = await request("/teams", {}, tokenOp);
  if (opList.status === 200) ok("operator (teams.read) can list teams");
  else fail("operator team list", opList);

  const viewList = await request("/teams", {}, tokenView);
  if (viewList.status === 200) ok("viewer (teams.read) can list teams");
  else fail("viewer team list", viewList);

  const opCreate = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: "no-op" }) },
    tokenOp,
  );
  if (opCreate.status === 403) ok("operator cannot create a team (403)");
  else fail("operator team creation", opCreate);

  const viewCreate = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: "no-view" }) },
    tokenView,
  );
  if (viewCreate.status === 403) ok("viewer cannot create a team (403)");
  else fail("viewer team creation", viewCreate);

  // 11. Validation hardening.
  const emptyName = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: "" }) },
    tokenA,
  );
  if (emptyName.status === 400) ok("empty team name rejected (400)");
  else fail("empty team name", emptyName);

  const badMember = await request(
    `/teams/${teamId}/members`,
    { method: "POST", body: JSON.stringify({ userId: "not-a-uuid" }) },
    tokenA,
  );
  if (badMember.status === 400) ok("invalid member userId rejected (400)");
  else fail("invalid member userId", badMember);

  const badTeamId = await request("/teams/not-a-uuid", {}, tokenA);
  if (badTeamId.status === 400) ok("invalid team id path rejected (400)");
  else fail("invalid team id path", badTeamId);

  // 12. DELETE team as org A owner.
  const deleteOwn = await request(`/teams/${teamId}`, { method: "DELETE" }, tokenA);
  const afterDelete = await request(`/teams/${teamId}`, {}, tokenA);
  if (deleteOwn.status === 200 && afterDelete.status === 404)
    ok("team owner deletes team and fetch returns 404");
  else fail("team owner delete", { deleteOwn, afterDelete });

  // 13. Join-the-right-team induction.
  const defaultSearch = await request(
    `/teams?search=${encodeURIComponent("Default Team")}`,
    {},
    tokenA,
  );
  const defaultATeamId = (defaultSearch.body as { data?: Array<{ id: string }> })?.data?.[0]?.id;
  if (defaultATeamId) ok("org A default team exists");
  else fail("org A default team lookup", defaultSearch.body);

  const regEmail = `joiner-${RUN_TAG}@vigilens.io`;
  const enableReg = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ allow_registration: true }) },
    tokenA,
  );
  const reg = await request(
    "/auth/register",
    {
      method: "POST",
      body: JSON.stringify({ name: "Joiner User", email: regEmail, password: "Admin123!" }),
    },
  );
  const restoreReg = await request(
    "/settings/security",
    { method: "PATCH", body: JSON.stringify({ allow_registration: false }) },
    tokenA,
  );
  if (enableReg.status === 200 && restoreReg.status === 200)
    ok("registration policy toggled and restored for induction test");
  else fail("registration policy toggle", { enableReg, restoreReg });
  const regUser = (reg.body as { data?: { user?: { id?: string; teamId?: string | null } } })?.data?.user;
  if (reg.status === 201 && regUser?.id && regUser.teamId === defaultATeamId) {
    ok("self-registered user is inducted into the org default team");
    createdUserIds.push(regUser.id);
  } else {
    fail("register induction", reg.body);
  }

  const adminCreatedEmail = `inductee-${RUN_TAG}@vigilens.io`;
  const adminCreate = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Admin Inductee",
        email: adminCreatedEmail,
        password: "Admin123!",
      }),
    },
    tokenA,
  );
  const adminCreatedId = (adminCreate.body as { data?: { id?: string; teamId?: string | null } })?.data?.id;
  if (adminCreate.status === 201 && adminCreatedId) {
    const fetched = await request(`/users/${adminCreatedId}`, {}, tokenA);
    const fetchedTeamId = (fetched.body as { data?: { teamId?: string | null } })?.data?.teamId;
    if (fetchedTeamId === defaultATeamId)
      ok("admin-created user is inducted into the org default team");
    else fail("admin create induction", fetched.body);
    createdUserIds.push(adminCreatedId);
  } else {
    fail("admin create induction", adminCreate.body);
  }

  const orgBInducteeEmail = `orgb-inductee-${RUN_TAG}@vigilens.io`;
  const orgBInductee = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Tenant B Inductee",
        email: orgBInducteeEmail,
        password: "Admin123!",
      }),
    },
    tokenB,
  );
  const orgBInducteeId = (orgBInductee.body as { data?: { id?: string } })?.data?.id;
  if (orgBInductee.status === 201 && orgBInducteeId) {
    const fetchedB = await request(`/users/${orgBInducteeId}`, {}, tokenB);
    const orgBTempTeamId = (fetchedB.body as { data?: { teamId?: string | null } })?.data?.teamId;
    if (orgBTempTeamId && orgBTempTeamId !== defaultATeamId) {
      const orgBTeamDetail = await request(`/teams/${orgBTempTeamId}`, {}, tokenB);
      const orgBTeamOrg =
        (orgBTeamDetail.body as { data?: { organizationId?: string } })?.data?.organizationId;
      if (orgBTeamOrg === fixture.orgId)
        ok("tenant B induction joins tenant B's own default team (right team per tenant)");
      else fail("tenant B induced team org", orgBTeamDetail.body);
    } else {
      fail("tenant B induction team", fetchedB.body);
    }
  } else {
    fail("tenant B inductee creation", orgBInductee.body);
  }

  // 14. Server-side team invitation tokens.
  const inviteTeamName = `Invite Team ${RUN_TAG}`;
  const inviteTeam = await request(
    "/teams",
    { method: "POST", body: JSON.stringify({ name: inviteTeamName }) },
    tokenA,
  );
  const inviteTeamId = (inviteTeam.body as { data?: { id?: string } })?.data?.id;
  if (inviteTeam.status === 201 && inviteTeamId) {
    ok("invitation fixture team created");
    createdTeamIds.push(inviteTeamId);
  } else {
    fail("invitation fixture team", inviteTeam);
    return;
  }

  const inviteeEmail = `invitee-${RUN_TAG}@vigilens.io`;
  const inviteCreate = await request(
    `/teams/${inviteTeamId}/invitations`,
    { method: "POST", body: JSON.stringify({ email: inviteeEmail }) },
    tokenA,
  );
  const inviteData = (inviteCreate.body as {
    data?: { token?: string; invitation?: { id?: string; status?: string } };
  })?.data;
  if (inviteCreate.status === 201 && inviteData?.token && inviteData.invitation?.status === "pending") {
    ok("invitation created with a one-time token");
  } else {
    fail("invitation create", inviteCreate.body);
  }
  const invToken = inviteData?.token ?? "";

  const invList = await request(`/teams/${inviteTeamId}/invitations`, {}, tokenA);
  const invListData = (invList.body as { data?: Array<{ email: string }> })?.data ?? [];
  if (invList.status === 200 && invListData.some((v) => v.email === inviteeEmail))
    ok("invitations list exposes created invitation");
  else fail("invitations list", invList.body);

  const dupInv = await request(
    `/teams/${inviteTeamId}/invitations`,
    { method: "POST", body: JSON.stringify({ email: inviteeEmail }) },
    tokenA,
  );
  if (dupInv.status === 409) ok("duplicate pending invitation rejected (409)");
  else fail("duplicate invitation", dupInv);

  const wrongAccept = await request(
    "/teams/invitations/accept",
    { method: "POST", body: JSON.stringify({ token: invToken }) },
    tokenOp,
  );
  if (wrongAccept.status === 403) ok("accepting with a different email is blocked (403)");
  else fail("wrong-email accept", wrongAccept);

  const inviteeCreate = await request(
    "/users",
    {
      method: "POST",
      body: JSON.stringify({
        name: "Invited User",
        email: inviteeEmail,
        password: "admin123",
      }),
    },
    tokenA,
  );
  const inviteeId = (inviteeCreate.body as { data?: { id?: string } })?.data?.id;
  if (inviteeCreate.status !== 201 || !inviteeId) {
    fail("create invited user", inviteeCreate);
    return;
  }
  createdUserIds.push(inviteeId);
  const inviteeLogin = await login(inviteeEmail);
  if (!inviteeLogin) {
    fail("invitee login", null);
    return;
  }
  const tokenInvitee = inviteeLogin.token;
  const acceptRes = await request(
    "/teams/invitations/accept",
    { method: "POST", body: JSON.stringify({ token: invToken }) },
    tokenInvitee,
  );
  const acceptedTeamId = (acceptRes.body as { data?: { teamId?: string } })?.data?.teamId;
  if (acceptRes.status === 200 && acceptedTeamId === inviteTeamId)
    ok("invitee accepts invitation and joins the team");
  else fail("accept invitation", acceptRes);

  const bAccept = await request(
    "/teams/invitations/accept",
    { method: "POST", body: JSON.stringify({ token: invToken }) },
    tokenB,
  );
  if (bAccept.status === 404) ok("cross-tenant acceptance returns 404");
  else fail("cross-tenant accept", bAccept);

  const revokeEmail = `revokee-${RUN_TAG}@vigilens.io`;
  const revokeCreate = await request(
    `/teams/${inviteTeamId}/invitations`,
    { method: "POST", body: JSON.stringify({ email: revokeEmail }) },
    tokenA,
  );
  const revokeInvitationId = (revokeCreate.body as {
    data?: { invitation?: { id?: string } };
  })?.data?.invitation?.id;
  const revokeToken = (revokeCreate.body as { data?: { token?: string } })?.data?.token;
  if (revokeCreate.status === 201 && revokeInvitationId && revokeToken)
    ok("second invitation created for revoke test");
  else {
    fail("second invitation", revokeCreate);
    return;
  }

  const revokeRes = await request(
    `/teams/${inviteTeamId}/invitations/${revokeInvitationId}`,
    { method: "DELETE" },
    tokenA,
  );
  if (revokeRes.status === 200) ok("invitation revoked");
  else fail("revoke invitation", revokeRes);

  const revokedAccept = await request(
    "/teams/invitations/accept",
    { method: "POST", body: JSON.stringify({ token: revokeToken }) },
    tokenInvitee,
  );
  if (revokedAccept.status === 400) ok("revoked invitation cannot be accepted (400)");
  else fail("revoked accept", revokedAccept);

  const opCreateInv = await request(
    `/teams/${inviteTeamId}/invitations`,
    { method: "POST", body: JSON.stringify({ email: "nobody@vigilens.io" }) },
    tokenOp,
  );
  if (opCreateInv.status === 403) ok("operator cannot create invitations (403)");
  else fail("operator create invitation", opCreateInv);

  const viewListInv = await request(`/teams/${inviteTeamId}/invitations`, {}, tokenView);
  if (viewListInv.status === 200) ok("viewer can list invitations (teams.read)");
  else fail("viewer list invitations", viewListInv);

  const bCreateInv = await request(
    `/teams/${inviteTeamId}/invitations`,
    { method: "POST", body: JSON.stringify({ email: "nobody@vigilens.io" }) },
    tokenB,
  );
  if (bCreateInv.status === 404) ok("cross-tenant invitation create returns 404");
  else fail("cross-tenant create invitation", bCreateInv);

  const badEmail = await request(
    `/teams/${inviteTeamId}/invitations`,
    { method: "POST", body: JSON.stringify({ email: "not-an-email" }) },
    tokenA,
  );
  if (badEmail.status === 400) ok("invalid email rejected (400)");
  else fail("bad email invitation", badEmail);

  const badToken = await request(
    "/teams/invitations/accept",
    { method: "POST", body: JSON.stringify({ token: "short" }) },
    tokenInvitee,
  );
  if (badToken.status === 400) ok("invalid token rejected (400)");
  else fail("bad token accept", badToken);

  if (failed > 0) {
    console.log(`\n${failed} team test(s) FAILED, ${passed} passed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${passed} team tests passed.`);
  }
}

run()
  .catch((err) => {
    console.error("team test run crashed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void (async () => {
      if (server) killProcessTree(server);
      if (createdTeamIds.length > 0) {
        await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
      }
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }
      if (orgB) await cleanupOrgB(orgB.orgId);
      await prisma.$disconnect();
    })();
  });