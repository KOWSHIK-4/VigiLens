# Deployment

## Vercel Architecture

VigiLens is deployed as two separate Vercel projects that work together:

- **Frontend project (`vigilens`)** — the static React SPA, currently aliased
  at `https://vigilens-rho.vercel.app`. `frontend/vercel.json` rewrites every
  `/api/*` request to the backend project and serves `index.html` for all
  other routes (SPA fallback). The browser therefore talks to the API
  **same-origin** (`https://vigilens-rho.vercel.app/api/...`), and Vercel's
  edge proxy forwards those requests to the backend.
- **Backend project (`vigilens-api`)** — the serverless Express function,
  served at `https://vigilens-api.vercel.app`. `backend/vercel.json`
  installs dependencies, applies Prisma migrations, and rewrites all routes
  into the `api/index.ts` serverless function. It does **not** seed: an
  operator provisions initial data explicitly with `npm run prisma:seed`
  against an empty database. The linked project names come from
  `frontend/.vercel/project.json` and `backend/.vercel/project.json`.

Relationship: the SPA never calls the backend origin directly — the frontend
rewrite is the single proxy path. Because preflight and cross-origin requests
still carry the `Origin: https://vigilens-rho.vercel.app` header after Vercel's
rewrite, the backend's CORS allow-list must include the **frontend**
production origin. Set `CORS_ORIGIN` explicitly; the committed fallback list
also covers `https://vigilens-rho.vercel.app` and the historical
`https://vigilens.vercel.app` host. Update both the Vercel alias and the CORS
allow-list together if the frontend domain changes.

### Required `vigilens-api` production environment

The backend fails closed at import time (`backend/src/config/index.ts`) when a
production secret is missing or insecure, which surfaces as HTTP 500
`FUNCTION_INVOCATION_FAILED` on **every** route, including `/health`. The
`vigilens-api` project must therefore have at least:

| Variable | Required | Value / how to produce |
|----------|----------|-----------------------|
| `DATABASE_URL` | Yes | Managed PostgreSQL connection string; must not contain a default password |
| `JWT_SECRET` | Yes | Random string, min 32 chars, not a placeholder |
| `INTERNAL_API_KEY` | Yes | Random string, min 32 chars, not a placeholder |
| `CAMERA_CREDENTIALS_KEY` | Yes | `openssl rand -hex 32` — 32 bytes as 64 hex chars (or base64) |
| `CORS_ORIGIN` | Recommended | `https://vigilens-rho.vercel.app` (comma-separated for more origins) |
| `AI_SERVICE_URL` | Only with live inference | Base URL of a reachable AI service; omit when none is deployed |

`CAMERA_CREDENTIALS_KEY` is a stable secret shared by every function
invocation. Never generate it per request, never commit it, and never place it
in a `VITE_*` variable. Rotating it requires keeping the previous value in
`CAMERA_CREDENTIALS_KEY_LEGACY` so already-encrypted camera credentials remain
decryptable.

Setting `CORS_ORIGIN` **replaces** the built-in allow-list rather than adding
to it, so the value must name the deployed frontend origin explicitly. The
built-in fallback is only a safety net for a deployment that has not set it.

`AI_SERVICE_URL` left unset is a supported configuration: the AI service is
reported as `not_configured` on `/health/ready` (excluded from the readiness
aggregate) and every AI-dependent endpoint returns HTTP 502 with
`AI_SERVICE_UNREACHABLE`. Do not point it at `http://localhost:8000` on a
serverless platform — that address can never resolve there.

## Docker Compose (Recommended)

```bash
cp .env.example .env
docker compose up -d
```

The compose stack hardens production behavior:

- **Network isolation** — PostgreSQL and the AI service run on an internal
  Docker network (`internal: true`); only the backend and frontend are
  reachable from outside the container stack.
- **Resource limits** — each service pins CPU/memory via `cpus`/`mem_limit`.
- **Health checks** — backend uses `/health/live`, AI service uses `/health`.
- **Storage** — the backend data volume is mounted at `/data/vigilens` and
  created with the correct ownership (`mkdir -p /data/vigilens` in the image)
  so the service runs as a non-root user.
- **nginx** — the frontend ships a production nginx config template
  (`frontend/nginx.conf.template`; gzip, caching, SPA fallback) rendered at
  container start. When `INTERNAL_API_KEY` is set, the `/detect/` proxy
  injects it as `X-Internal-Key`, so the AI service's guarded webcam stream
  and stats endpoints accept browser requests without the secret ever
  reaching the client.
- **AI service** — runs with `NODE_ENV=production`, which enforces the
  internal-key check on the live webcam stream and stats endpoints and
  refuses insecure default secrets at startup.

### Production Environment

Before deploying, set these environment variables to secure values:

- `JWT_SECRET` — a strong random string (min 32 chars)
- `INTERNAL_API_KEY` — a shared secret for AI↔backend communication
- `CAMERA_CREDENTIALS_KEY` — 32-byte key (64 hex chars) for AES-256-GCM
  encryption of camera credentials at rest. Generate with
  `openssl rand -hex 32`. The backend refuses to start without it.
- `POSTGRES_PASSWORD` — a strong database password
- `DATABASE_URL` — must not contain the default `vigilens_secret` password
- `CORS_ORIGIN` — your production domain(s)

The backend and AI service refuse to start in `NODE_ENV=production` if
insecure default secrets or weak database passwords are detected.

## Graceful Shutdown

The backend handles `SIGTERM`/`SIGINT`: it stops accepting new connections,
closes keep-alive connections, awaits in-flight requests, then closes Prisma
and exits. If shutdown exceeds 10 seconds it forces an exit. Keep-alive
timeouts are tuned (65s) to drain long-lived connections behind proxies. Use
the `/health/ready` endpoint as the readiness gate so orchestrators only route
traffic once dependencies (database, storage, AI, cache) are healthy.

## Manual Deployment

### Backend

```bash
cd backend
npm ci
npx prisma migrate deploy
npm run build
npm start
```

### Frontend

Build static assets and serve via nginx or deploy to CDN:

```bash
cd frontend
npm ci
npm run build
```

### AI Service

```bash
cd ai
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Environment Variables

See `.env.example` for all configuration options. Never commit `.env` to version control.

## Testing

### Backend Unit Tests (vitest — no database required)

```bash
cd backend
npm run test:unit
```

Runs 432 pure unit tests across 43 files covering engine config, lifecycle,
postprocess, tracking, hardening, detection status, camera credential
encryption, reports/exports, monitoring, and security validation. Uses the
`.vitest.test.ts` suffix so they don't conflict with integration tests.

### Backend Integration Tests (tsx — requires PostgreSQL)

```bash
cd backend
NODE_ENV=test npm test
```

Runs all test files sequentially via `tsx`. Integration tests start the
backend server and require a running PostgreSQL database. These include
RBAC, user management, camera, detector, model, audit, settings,
monitoring, MFA, realtime, isolation, and engine API tests. `NODE_ENV=test`
is required when the committed local `backend/.env` sets
`NODE_ENV=production`, because the production startup guard intentionally
refuses to run without production-grade secrets.

### AI Service Tests (pytest)

```bash
cd ai
pip install -r requirements-dev.txt
python -m pytest
ruff check .
```

93 tests covering health, detection routes, capture, confidence validation,
IoU tracking, webcam stats, and the detector catalog. Uses mocks for camera
hardware — no real cameras needed.

### End-to-End Verification

```bash
cd frontend
NODE_ENV=test npm run test:e2e
```

Spawns both backend and frontend dev servers, verifies the Vite `/api` proxy,
login, model/detector catalogues, system monitoring and metrics, detections,
alerts, and CSV export. Requires a local PostgreSQL database with migrations
applied and seed data present; it never targets production.
