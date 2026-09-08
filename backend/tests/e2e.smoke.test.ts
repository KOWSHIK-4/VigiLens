import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.E2E_API_URL || "http://localhost:4000/api";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || "http://localhost:4173";
const REQUEST_TIMEOUT_MS = 10_000;
const GLOBAL_TIMEOUT_MS = 90_000;

let passed = 0;
let failed = 0;

setTimeout(() => {
  console.error(`\nFAIL  smoke test did not complete within ${GLOBAL_TIMEOUT_MS} ms`);
  console.error(`${passed} passed, ${failed} failed`);
  process.exit(1);
}, GLOBAL_TIMEOUT_MS).unref();

async function fetchWithTimeout(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${JSON.stringify(detail)}`);
}

async function json(path: string, options: RequestInit = {}, token?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchWithTimeout(`${BASE_URL}${path}`, { ...options, headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function main() {
  console.log(`E2E smoke test against ${BASE_URL} and ${FRONTEND_URL}`);

  try {
    const front = await fetchWithTimeout(FRONTEND_URL);
    if (front.ok) {
      ok(`frontend serves at ${FRONTEND_URL} (HTTP ${front.status})`);
    } else {
      fail("frontend availability", front.status);
    }
  } catch (err) {
    fail("frontend availability", String(err));
  }

  const login = await json("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@vigilens.io", password: "admin123" }),
  });
  if (login.status !== 200) {
    fail("admin login", login);
    return;
  }
  const token = (login.body as { data: { token: string } }).data.token;
  ok("admin login");

  const list = await json("/models?page=1&limit=100", {}, token);
  const listBody = list.body as { total: number; data: Array<{ name: string; detectorKey: string }> };
  if (list.status === 200 && listBody.total === 8) {
    ok("8 default models seeded");
  } else {
    fail("seeded model count", { status: list.status, total: listBody?.total });
  }

  const requiredKeys = [
    "person",
    "fire",
    "smoking",
    "helmet",
    "face_mask",
    "vehicle",
    "intrusion",
    "drowsiness",
  ];
  const presentKeys = (listBody?.data ?? []).map((m) => m.detectorKey);
  const missing = requiredKeys.filter((k) => !presentKeys.includes(k));
  if (missing.length === 0) {
    ok("all required detector keys present");
  } else {
    fail("required detector keys", { missing });
  }

  const active = await json("/models/active", {}, token);
  if (
    active.status === 200 &&
    (active.body as { data: { status: string } }).data.status === "loaded"
  ) {
    ok("active model endpoint returns a loaded model");
  } else {
    fail("active model endpoint", active);
  }

  const key = `e2e_${Date.now()}`;
  const created = await json(
    "/models",
    {
      method: "POST",
      body: JSON.stringify({
        name: "E2E Smoke Model",
        version: "1.0.0",
        detectorKey: key,
        confidenceThreshold: 50,
        enabled: true,
        gpuSupported: true,
        modelPath: "/models/e2e/e2e.pt",
      }),
    },
    token,
  );
  if (created.status !== 201) {
    fail("create model", created);
    return;
  }
  const id = (created.body as { data: { id: string } }).data.id;
  ok("create model via API");

  const removed = await json(`/models/${id}`, { method: "DELETE" }, token);
  if (removed.status === 200) {
    ok("delete model via API");
  } else {
    fail("delete model", removed);
  }

  const monitoring = await json("/system/monitoring", {}, token);
  const monBody = (monitoring.body as {
    data: {
      scheduler: { running: boolean; loopCount: number; loops?: unknown[] };
      engines: unknown[];
    };
  }).data;
  if (
    monitoring.status === 200 &&
    typeof monBody.scheduler?.running === "boolean" &&
    Array.isArray(monBody.scheduler?.loops) &&
    Array.isArray(monBody.engines)
  ) {
    ok(`GET /system/monitoring returns ${monBody.engines.length} engines and ${monBody.scheduler.loopCount} loops`);
  } else {
    fail("GET /system/monitoring", monitoring);
  }

  const metrics = await json("/system/metrics", {}, token);
  const metricsBody = (metrics.body as {
    data: { requests: { total: number }; detections: { total: number } };
  }).data;
  if (
    metrics.status === 200 &&
    typeof metricsBody.requests?.total === "number" &&
    typeof metricsBody.detections?.total === "number"
  ) {
    ok("GET /system/metrics returns request and detection aggregates");
  } else {
    fail("GET /system/metrics", metrics);
  }

  const detections = await json("/detections?page=1&limit=5", {}, token);
  const detBody = detections.body as { data: Array<{ status: string }> };
  const validDetStatuses = ["critical", "warning", "info"];
  if (
    detections.status === 200 &&
    Array.isArray(detBody?.data) &&
    detBody.data.every((d) => validDetStatuses.includes(d.status))
  ) {
    ok(`GET /detections returns ${detBody.data.length} detections with valid statuses`);
  } else {
    fail("GET /detections", detections);
  }

  const alerts = await json("/alerts?page=1&limit=5", {}, token);
  const alertsBody = alerts.body as { data: unknown[] };
  if (alerts.status === 200 && Array.isArray(alertsBody?.data)) {
    ok(`GET /alerts returns ${alertsBody.data.length} alerts`);
  } else {
    fail("GET /alerts", alerts);
  }

  const exportRes = await fetchWithTimeout(`${BASE_URL}/alerts/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const csvText = await exportRes.text();
  if (exportRes.status === 200 && csvText.startsWith("ID,")) {
    ok("GET /alerts/export returns CSV rows");
  } else {
    fail("GET /alerts/export", { status: exportRes.status, preview: csvText.slice(0, 80) });
  }

  await sleep(200);
}

main()
  .catch((err) => {
    failed += 1;
    console.error("Unexpected error:", err);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
