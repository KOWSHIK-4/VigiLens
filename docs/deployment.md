# Deployment

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
- **nginx** — the frontend ships a production `nginx.conf` (gzip, caching,
  SPA fallback) instead of relying on the dev server.

### Production Environment

Before deploying, set these environment variables to secure defaults:

- `JWT_SECRET` — a strong random string (min 32 chars)
- `INTERNAL_API_KEY` — a shared secret for AI↔backend communication
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
npx vitest run
```

Runs 106 pure unit tests covering engine config, lifecycle, postprocess,
tracking, hardening, detection status, and security validation. Uses the
`.vitest.test.ts` suffix so they don't conflict with integration tests.

### Backend Integration Tests (tsx — requires PostgreSQL)

```bash
cd backend
npm run build
npm test
```

Runs all test files sequentially via `tsx`. Integration tests start the
backend server and require a running PostgreSQL database. These include
RBAC, user management, camera, detector, model, audit, settings,
monitoring, and engine API tests.

### AI Service Tests (pytest)

```bash
cd ai
pip install -r requirements-dev.txt
python -m pytest tests/ -v
```

31 tests covering health, detection routes, capture, confidence validation,
IoU tracking, webcam stats, and detector catalog. Uses mocks for camera
hardware — no real cameras needed.

### End-to-End Verification

```bash
cd frontend
npm run test:e2e-verify
```

Spawns both backend and frontend dev servers, verifies health endpoints,
login flow, and API responses. Requires both services to be installable.
