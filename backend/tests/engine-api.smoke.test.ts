import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as path from "node:path";

const TEST_PORT_BASE = 4899;
const TEST_PORT_RANGE = 500;
let TEST_PORT = TEST_PORT_BASE + (process.pid % TEST_PORT_RANGE);
let BASE_URL = `http://localhost:${TEST_PORT}/api`;

let passed = 0;
let failed = 0;

function ok(name: string, details?: string) {
  passed += 1;
  console.log(`  PASS  ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name: string, details?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

async function waitForServer(port: number, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function resolveTestPort(base: number, range: number): Promise<number> {
  for (let offset = 0; offset < 100; offset++) {
    const candidate = base + ((process.pid + offset) % range);
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`no free test port in ${base}-${base + range}`);
}

let server: ChildProcess;

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  server = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "src/index.ts"],
    { cwd: process.cwd(), stdio: "ignore", env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: "test" } },
  );

  if (!(await waitForServer(TEST_PORT))) {
    fail("server startup", "backend did not become healthy");
    return;
  }
  ok("backend started and /health responds");

  const login = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  const loginBody = (await login.json()) as { data?: { token?: string } };
  const token = loginBody.data?.token;
  if (!token) {
    fail("admin login", "no token");
    return;
  }
  ok("admin login returns token");

  const headers = { Authorization: `Bearer ${token}` };

  // Engine descriptor list.
  const listRes = await fetch(`${BASE_URL}/engines`, { headers });
  const listBody = (await listRes.json()) as {
    data?: Array<{ key: string; availability: string; status: string; supportedInput: string[] }>;
  };
  const descriptors = listBody.data ?? [];
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    fail("GET /engines lists descriptors", `got ${descriptors.length}`);
  } else {
    ok("GET /engines lists descriptors", `${descriptors.length} entries`);
  }

  const person = descriptors.find((d) => d.key === "person");
  if (person) {
    ok("person descriptor present", `availability=${person.availability} status=${person.status}`);
  } else {
    fail("person descriptor present", "missing");
  }

  // Unconfigured detector must refuse inference (no fabrication).
  const fire = descriptors.find((d) => d.key === "fire");
  if (fire && fire.availability === "unconfigured") {
    ok("fire descriptor marked unconfigured", `availability=${fire.availability}`);
  }

  // Process an image through the person engine (real inference against AI service).
  const fs = await import("node:fs");
  const imagePath = process.env.TEST_IMAGE_PATH;
  if (imagePath && fs.existsSync(imagePath)) {
    const form = new FormData();
    const data = fs.readFileSync(imagePath);
    form.append("image", new Blob([new Uint8Array(data)], { type: "image/jpeg" }), "frame.jpg");
    const procRes = await fetch(`${BASE_URL}/engines/person/process`, {
      method: "POST",
      headers,
      body: form,
    });
    const procBody = (await procRes.json()) as { data?: { count: number; metrics?: Record<string, unknown> } };
    if (procRes.ok && procBody.data) {
      ok("POST /engines/person/process runs real inference", `count=${procBody.data.count}`);
      ok("process returns metrics", JSON.stringify(procBody.data.metrics).slice(0, 90));

      // A successful engine run transitions the lifecycle to ready.
      const afterRes = await fetch(`${BASE_URL}/engines/person`, { headers });
      const afterBody = (await afterRes.json()) as { data?: { status: string; enabled: boolean } };
      if (afterRes.ok && afterBody.data?.status === "ready" && afterBody.data.enabled === true) {
        ok("person lifecycle becomes ready after successful run", `status=${afterBody.data.status}`);
      } else {
        fail("person lifecycle becomes ready after successful run", JSON.stringify(afterBody.data));
      }
    } else {
      fail("POST /engines/person/process", JSON.stringify(procBody).slice(0, 200));
    }

    // An unconfigured detector with a valid image must be refused — no fabrication.
    const fireForm = new FormData();
    fireForm.append("image", new Blob([new Uint8Array(data)], { type: "image/jpeg" }), "frame.jpg");
    const fireProc = await fetch(`${BASE_URL}/engines/fire/process`, {
      method: "POST",
      headers,
      body: fireForm,
    });
    const fireBody = (await fireProc.json()) as { code?: string };
    if (fireProc.status === 501 && fireBody.code === "DETECTOR_UNCONFIGURED") {
      ok("POST /engines/fire/process refused for unconfigured detector (501)", `code=${fireBody.code}`);
    } else {
      fail("POST /engines/fire/process refused for unconfigured detector", `status=${fireProc.status}`);
    }
  } else {
    console.log("  SKIP  real inference (no TEST_IMAGE_PATH provided)");

    // Without a real image, an empty payload is still rejected.
    const fireProc = await fetch(`${BASE_URL}/engines/fire/process`, {
      method: "POST",
      headers,
      body: new FormData(),
    });
    if (fireProc.status === 400 || fireProc.status === 501) {
      ok("POST /engines/fire/process rejected", `status=${fireProc.status}`);
    } else {
      fail("POST /engines/fire/process rejected", `status=${fireProc.status}`);
    }
  }

  // Metrics endpoint.
  const metricsRes = await fetch(`${BASE_URL}/engines/person/metrics`, { headers });
  if (metricsRes.ok) {
    ok("GET /engines/person/metrics returns metrics");
  } else {
    fail("GET /engines/person/metrics", `status=${metricsRes.status}`);
  }

  // Unauthorized.
  const unauth = await fetch(`${BASE_URL}/engines`);
  if (unauth.status === 401) {
    ok("engine routes require authentication (401)");
  } else {
    fail("engine routes require authentication", `status=${unauth.status}`);
  }

  console.log(`\nEngine API smoke tests: ${passed} passed, ${failed} failed`);
  server.kill();
  process.exit(failed === 0 ? 0 : 1);
}

run();
