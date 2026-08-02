import { setTimeout as sleep } from "node:timers/promises";

const BASE_URL = process.env.E2E_API_URL || "http://localhost:4000/api";
const FRONTEND_URL = process.env.E2E_FRONTEND_URL || "http://localhost:4173";

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

async function json(path: string, options: RequestInit = {}, token?: string) {
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

async function main() {
  console.log(`E2E smoke test against ${BASE_URL} and ${FRONTEND_URL}`);

  try {
    const front = await fetch(FRONTEND_URL);
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
