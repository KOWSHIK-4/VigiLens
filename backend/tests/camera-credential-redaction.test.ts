import { spawn, execSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createServer } from "node:net";

const TEST_PORT_BASE = 4921;
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

interface CameraLike {
  id: string;
  name: string;
  username?: string | null;
  password?: unknown;
}

function hasNoPassword(camera: unknown): boolean {
  return typeof camera === "object" && camera !== null && !("password" in camera);
}

async function run() {
  try {
    TEST_PORT = await resolveTestPort(TEST_PORT_BASE, TEST_PORT_RANGE);
    BASE_URL = `http://localhost:${TEST_PORT}/api`;
  } catch (err) {
    fail("test port reservation", String(err));
    return;
  }

  console.log(`Starting backend server on port ${TEST_PORT} for credential redaction tests...`);
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

  let cameraId: string | null = null;

  try {
    const created = await request(
      "/cameras",
      {
        method: "POST",
        body: JSON.stringify({
          name: `redaction-test-${process.pid}`,
          url: "rtsp://stream.example.com/live",
          cameraType: "rtsp",
          username: "stream-user",
          password: "super-secret-stream-password",
        }),
      },
      token,
    );
    const createdBody = created.body as { data?: CameraLike };
    if (
      created.status === 201 &&
      createdBody.data &&
      hasNoPassword(createdBody.data) &&
      createdBody.data.username === "stream-user"
    ) {
      cameraId = createdBody.data.id;
      ok("POST /cameras response omits the stored password");
    } else {
      fail("create camera redaction", created.body);
      return;
    }

    const list = await request("/cameras?limit=100", {}, token);
    const listBody = list.body as { data?: CameraLike[] };
    if (
      list.status === 200 &&
      Array.isArray(listBody.data) &&
      listBody.data.every(hasNoPassword)
    ) {
      ok("GET /cameras list rows omit the password field");
    } else {
      fail("camera list redaction", list.body);
    }

    if (cameraId) {
      const detail = await request(`/cameras/${cameraId}`, {}, token);
      const detailBody = detail.body as { data?: CameraLike };
      if (detail.status === 200 && detailBody.data && hasNoPassword(detailBody.data)) {
        ok("GET /cameras/:id omits the password field");
      } else {
        fail("camera detail redaction", detail.body);
      }

      const updated = await request(
        `/cameras/${cameraId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ name: `redaction-test-${process.pid}-renamed` }),
        },
        token,
      );
      const updatedBody = updated.body as { data?: CameraLike };
      if (updated.status === 200 && updatedBody.data && hasNoPassword(updatedBody.data)) {
        ok("PATCH /cameras/:id response omits the password field");
      } else {
        fail("camera update redaction", updated.body);
      }

      const internalKey =
        process.env.INTERNAL_API_KEY || "dev-internal-key-change-in-production";
      const ingested = await request(
        "/detections/internal",
        {
          method: "POST",
          headers: { "X-Internal-Key": internalKey },
          body: JSON.stringify({
            camera_id: cameraId,
            label: "person",
            confidence: 0.91,
            skip_alert: true,
          }),
        },
      );
      const ingestedBody = ingested.body as {
        data?: { id: string; camera?: CameraLike };
      };
      if (
        ingested.status === 201 &&
        ingestedBody.data?.camera &&
        hasNoPassword(ingestedBody.data.camera)
      ) {
        ok("nested camera inside an ingestion response omits the password");
      } else {
        fail("nested camera redaction (internal ingestion)", ingested.body);
      }

      if (ingestedBody.data) {
        const detectionDetail = await request(
          `/detections/${ingestedBody.data.id}`,
          {},
          token,
        );
        const detectionBody = detectionDetail.body as {
          data?: { camera?: CameraLike };
        };
        if (
          detectionDetail.status === 200 &&
          detectionBody.data?.camera &&
          hasNoPassword(detectionBody.data.camera)
        ) {
          ok("nested camera inside GET /detections/:id omits the password");
        } else {
          fail("nested camera redaction (detection detail)", detectionDetail.body);
        }
      }
    }
  } finally {
    if (cameraId) {
      await request(`/cameras/${cameraId}`, { method: "DELETE" }, token);
    }
  }

  console.log(`\nCamera credential redaction tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().finally(() => {
  if (server) killProcessTree(server);
});
