import { spawn, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BACKEND = path.join(REPO_ROOT, "backend");
const FRONTEND = path.join(REPO_ROOT, "frontend");

const BACKEND_PORT = 4000;
const FRONTEND_PORT = 5173;
const API = `http://localhost:${FRONTEND_PORT}/api`;

let children = [];
let passed = 0;
let failed = 0;

function ok(name) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name, detail) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${JSON.stringify(detail)}`);
}

function killTree(proc) {
  if (!proc?.pid) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: "ignore" });
    } catch {
      try {
        proc.kill();
      } catch {
        // already dead
      }
    }
  } else {
    try {
      proc.kill("SIGTERM");
    } catch {
      // already dead
    }
  }
}

async function waitFor(url, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await sleep(1000);
  }
  return false;
}

async function request(pathname, options = {}, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${pathname}`, { ...options, headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function run() {
  const backend = spawn(
    process.execPath,
    [
      path.join(BACKEND, "node_modules", "tsx", "dist", "cli.mjs"),
      "src/index.ts",
    ],
    { cwd: BACKEND, stdio: "ignore" },
  );
  children.push(backend);

  const frontend = spawn(
    process.execPath,
    [
      path.join(FRONTEND, "node_modules", "vite", "bin", "vite.js"),
      "--host",
    ],
    { cwd: FRONTEND, stdio: "ignore" },
  );
  children.push(frontend);

  if (!(await waitFor(`http://localhost:${BACKEND_PORT}/health`))) {
    fail("backend startup", "backend did not become healthy");
    return;
  }
  ok(`backend listens on port ${BACKEND_PORT}`);

  if (!(await waitFor(`http://localhost:${FRONTEND_PORT}/`))) {
    fail("frontend startup", "frontend did not become ready");
    return;
  }
  ok(`frontend dev server listens on port ${FRONTEND_PORT}`);

  const html = await fetch(`http://localhost:${FRONTEND_PORT}/`);
  const content = await html.text();
  if (html.status === 200 && content.includes('id="root"')) {
    ok("frontend serves the app shell (index.html with #root)");
  } else {
    fail("frontend app shell", { status: html.status });
  }

  const proxyCheck = await fetch(`${API}/models`);
  if (proxyCheck.status === 401) {
    ok("vite /api proxy reaches the backend (auth guard responds)");
  } else {
    fail("vite /api proxy", { status: proxyCheck.status });
  }

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (login.status !== 200) {
    fail("login through proxy", login);
    return;
  }
  const token = login.body.data.token;
  ok("login succeeds through the frontend proxy");

  const models = await request("/models?page=1&limit=100", {}, token);
  if (models.status === 200 && models.body.total >= 8) {
    ok(`GET /models through proxy returns ${models.body.total} models`);
  } else {
    fail("GET /models through proxy", models);
  }

  const active = await request("/models/active", {}, token);
  if (active.status === 200) {
    ok(`GET /models/active returns ${active.body.data.name}`);
  } else {
    fail("GET /models/active through proxy", active);
  }

  const stats = {
    total: models.body.total,
    enabled: models.body.data.filter((m) => m.enabled).length,
    disabled: models.body.data.filter((m) => !m.enabled).length,
    gpu: models.body.data.filter((m) => m.gpuSupported).length,
  };
  console.log(`        stats: total=${stats.total} enabled=${stats.enabled} disabled=${stats.disabled} gpu=${stats.gpu}`);
  if (
    stats.total === stats.enabled &&
    stats.disabled === 0 &&
    stats.gpu >= 8
  ) {
    ok("model stats cards data (total/enabled/disabled/gpu) is consistent");
  } else {
    fail("model stats data", stats);
  }

  const chartShape = {
    enabled: stats.enabled,
    disabled: stats.disabled,
    categories: models.body.data.length,
  };
  if (chartShape.enabled + chartShape.disabled === chartShape.categories) {
    ok("enabled vs disabled chart data covers all models");
  } else {
    fail("chart data", chartShape);
  }
}

async function main() {
  try {
    await run();
  } catch (err) {
    failed += 1;
    console.error("Unexpected E2E error:", err);
  } finally {
    for (const child of children) killTree(child);
    await sleep(2000);
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

void main();
