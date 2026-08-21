import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 4961;
const TEST_PORT_RANGE = 500;
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

async function request(pathname: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${pathname}`, { ...options, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, text };
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

async function run() {
  let cameraId: string | null = null;

  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for CSV export tests...`);
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

  // Fixtures carrying spreadsheet formula payloads.
  const camera = await prisma.camera.create({
    data: { name: "=cmd|'/c calc'!A1", url: "/dev/null", cameraType: "usb" },
  });
  cameraId = camera.id;
  const detection = await prisma.detection.create({
    data: {
      cameraId: camera.id,
      label: '=HYPERLINK("http://evil.example","pwn")',
      confidence: 0.5,
      imageUrl: "+SUM(A1:A9)",
    },
  });
  const auditLog = await prisma.auditLog.create({
    data: {
      action: "settings_changed",
      module: "@evil",
      description: "=1+1",
      username: "-not-a-flag",
      status: "success",
    },
  });

  const detRes = await request("/detections/export/csv?search=HYPERLINK", {}, token);
  const detCsv = detRes.text;
  const sanitizedLabel = detCsv.includes("'=HYPERLINK");
  const rawLabel = /(^|,)"=HYPERLINK/.test(detCsv);
  if (detRes.status === 200 && sanitizedLabel && !rawLabel) {
    ok("detection CSV neutralises a HYPERLINK formula payload");
  } else {
    fail("detection CSV sanitisation", { status: detRes.status, sanitizedLabel, rawLabel });
  }

  if (detCsv.includes("\"'+SUM(A1:A9)\"")) {
    ok("detection CSV neutralises a +SUM payload in the image url column");
  } else {
    fail("+SUM payload", detCsv.split("\n").find((l) => l.includes("SUM")));
  }

  if (detCsv.includes("\"'=cmd|'/c calc'!A1\"")) {
    ok("camera name with a cmd payload is neutralised");
  } else {
    fail("camera name payload", detCsv.split("\n").find((l) => l.includes("cmd")));
  }

  const auditRes = await request("/audit-logs/export?search=%3D1%2B1", {}, token);
  const auditCsv = auditRes.text;
  if (auditRes.status === 200 && auditCsv.includes("'=1+1") && !/(^|,)"=1\+1/.test(auditCsv)) {
    ok("audit log CSV neutralises an =1+1 description");
  } else {
    fail("audit CSV sanitisation", { status: auditRes.status, snippet: auditCsv.slice(0, 400) });
  }

  // Benign values must not be mutated.
  await prisma.detection.create({
    data: {
      cameraId: camera.id,
      label: "fixture-benign",
      confidence: 0.42,
      imageUrl: "benign.jpg",
    },
  });
  const benign2 = await request("/detections/export/csv?search=fixture-benign", {}, token);
  if (benign2.status === 200 && benign2.text.includes('"fixture-benign"')) {
    ok("benign labels are exported verbatim without a guard prefix");
  } else {
    fail("benign label passthrough", benign2.text.slice(0, 300));
  }

  void detection;
  void auditLog;

  console.log(`\nCSV export tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  await prisma.detection.deleteMany({ where: { cameraId: cameraId! } }).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { id: auditLog.id } }).catch(() => undefined);
  await prisma.camera.deleteMany({ where: { id: cameraId } }).catch(() => undefined);
}

run().finally(() => {
  if (server) killProcessTree(server);
  prisma.$disconnect().catch(() => undefined);
});
