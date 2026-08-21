import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TEST_PORT_BASE = 4951;
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

interface Bucket {
  range: string;
  count: number;
  percentage: number;
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

  console.log(`Starting backend server on port ${TEST_PORT} for analytics confidence tests...`);
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

  // Fixture: known confidence spread across all six buckets.
  const camera = await prisma.camera.create({
    data: { name: "confidence-test-cam", url: "/dev/null", cameraType: "usb" },
  });
  cameraId = camera.id;
  const confidences = [
    ...Array(3).fill(0.1), // 0-20%
    ...Array(2).fill(0.3), // 20-40%
    ...Array(5).fill(0.5), // 40-60%
    ...Array(7).fill(0.7), // 60-80%
    ...Array(4).fill(0.85), // 80-90%
    ...Array(9).fill(0.95), // 90-100%
  ];
  await prisma.detection.createMany({
    data: confidences.map((confidence, i) => ({
      cameraId: camera.id,
      label: `fixture-${i}`,
      confidence,
      imageUrl: `fixture-${i}.jpg`,
    })),
  });

  const res = await request("/analytics/confidence?period=90", {}, token);
  const buckets = (res.body as { data?: Bucket[] } | null)?.data;
  if (res.status !== 200 || !buckets || buckets.length !== 6) {
    fail("GET /analytics/confidence", res);
    return;
  }

  // The dev database contains unrelated detections, so derive the expected
  // counts from the same 90-day window the endpoint aggregates over.
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 90);
  windowStart.setHours(0, 0, 0, 0);
  const bounds: Array<[number, number | undefined]> = [
    [0, 0.2],
    [0.2, 0.4],
    [0.4, 0.6],
    [0.6, 0.8],
    [0.8, 0.9],
    [0.9, undefined],
  ];
  const expectedCounts: number[] = [];
  for (const [min, max] of bounds) {
    const n = await prisma.detection.count({
      where: {
        timestamp: { gte: windowStart },
        confidence: max === undefined ? { gte: min } : { gte: min, lt: max },
      },
    });
    expectedCounts.push(n);
  }

  const total = expectedCounts.reduce((a, b) => a + b, 0);
  let countsOk = true;
  let percentagesOk = true;
  for (let i = 0; i < 6; i++) {
    if (buckets[i].count !== expectedCounts[i]) countsOk = false;
    if (buckets[i].percentage !== Math.round((expectedCounts[i] / total) * 10000) / 100) {
      percentagesOk = false;
    }
  }
  if (!expectedCounts.every((c, i) => c >= [3, 2, 5, 7, 4, 9][i])) {
    fail("fixture visibility sanity check", expectedCounts);
  } else {
    ok("seeded fixtures are visible inside the aggregation window");
  }
  if (countsOk) ok("bucket counts match the database distribution");
  else fail("bucket counts", { buckets, expectedCounts });

  if (percentagesOk) ok("bucket percentages are rounded to two decimals");
  else fail("bucket percentages", buckets);

  // The cache key must distinguish custom ranges from period presets.
  const future = await request("/analytics/confidence?from=2030-01-01", {}, token);
  const futureBuckets = (future.body as { data?: Bucket[] } | null)?.data;
  if (
    future.status === 200 &&
    futureBuckets &&
    futureBuckets.every((b) => b.count === 0)
  ) {
    ok("a custom from-range is not served a stale period cache entry");
  } else {
    fail("custom range cache isolation", future);
  }

  console.log(`\nAnalytics confidence tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;

  await prisma.detection.deleteMany({ where: { cameraId: cameraId! } }).catch(() => undefined);
  await prisma.camera.deleteMany({ where: { id: cameraId } }).catch(() => undefined);
}

run().finally(() => {
  if (server) killProcessTree(server);
  prisma.$disconnect().catch(() => undefined);
});
