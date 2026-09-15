# VigiLens

**AI-Powered Security Monitoring Platform**

VigiLens is a production-ready, open-source security monitoring platform that detects safety and security violations from images, videos, and live camera streams using state-of-the-art computer vision models.

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  Frontend   │────▶│   Backend    │────▶│  AI Service│
│  React/Vite │◀────│  Express/TS  │◀────│ FastAPI/YOLO│
└─────────────┘     └──────┬───────┘     └────────────┘
                           │
                    ┌──────▼───────┐
                    │  PostgreSQL  │
                    └──────────────┘
```

## Tech Stack

| Layer       | Technology                                       |
|-------------|--------------------------------------------------|
| Frontend    | React, Vite, TypeScript, Tailwind CSS, Recharts  |
| Backend     | Express, TypeScript, Prisma ORM, JWT, Zod        |
| AI Engine   | Python 3.12+, FastAPI, Ultralytics YOLO, OpenCV  |
| Database    | PostgreSQL 16                                    |
| Infra       | Docker, Docker Compose, GitHub Actions           |

## Quick Start

```bash
git clone https://github.com/KOWSHIK-4/VigiLens.git
cd VigiLens

# Copy environment variables
cp .env.example .env

# Start all services
docker compose up -d

# Access the platform
open http://localhost
```

## Development

### Prerequisites

- Node.js 20+
- Python 3.12+
- Docker & Docker Compose
- PostgreSQL 16 (optional, Docker handles this)

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Backend

```bash
cd backend
npm install
npx prisma migrate dev
npm run dev
```

### AI Service

```bash
cd ai
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Environment Variables

Variables are split by service. Never put backend secrets into `VITE_*`
variables — those are embedded into the client bundle at build time.

### Frontend (Vite — client-side)

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:4000/api` | Backend API base URL |
| `VITE_WS_URL` | `ws://localhost:4000` | WebSocket URL for realtime events |

### Backend (Express/TypeScript)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | Set to `production` for live deployments |
| `PORT` | No | Server port (default `4000`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | HS256 signing key (min 32 chars). Generate with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | No | Token lifetime (default `7d`) |
| `AI_SERVICE_URL` | Yes | AI service base URL (e.g. `http://localhost:8000`) |
| `CORS_ORIGIN` | Yes | Comma-separated allowed origins |
| `INTERNAL_API_KEY` | Yes | Shared secret for AI↔backend communication. Must match `BACKEND_INTERNAL_KEY` on the AI service |
| `CAMERA_CREDENTIALS_KEY` | Yes | 32-byte key (64 hex chars) for AES-256-GCM encryption of camera credentials at rest. Generate with `openssl rand -hex 32` |
| `CAMERA_CREDENTIALS_KEY_LEGACY` | No | Previous key for decrypting rows written before a key rotation |
| `LOG_LEVEL` | No | Winston log level (default `info`) |
| `MONITOR_ENABLED` | No | Auto-start continuous monitoring at boot (default `false`) |
| `MONITOR_TICK_MS` | No | Monitor loop interval in ms (default `1000`) |
| `RETENTION_ENABLED` | No | Auto-start the data retention scheduler (default `true`) |
| `RETENTION_TICK_MS` | No | Retention check interval in ms (default `60000`) |

### AI Service (Python/FastAPI)

| Variable | Required | Description |
|----------|----------|-------------|
| `BACKEND_URL` | Yes | Backend base URL for webcam ingestion |
| `BACKEND_INTERNAL_KEY` | Yes | Must match `INTERNAL_API_KEY` on the backend |
| `AI_REQUIRE_AUTH` | No | Force internal-key auth on all endpoints (default in production). Legacy alias `AI_STATS_REQUIRE_AUTH` is still honored |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowed origins. Required in production |
| `LOG_LEVEL` | No | Python log level (default `INFO`) |
| `MEDIA_ROOT` | No | Base directory for captured media (default `/data/vigilens/media`) |
| `INFERENCE_TIMEOUT_S` | No | Max seconds per inference call (default `30`) |
| `INFERENCE_MAX_RETRIES` | No | Retries on transient failures (default `2`) |

### PostgreSQL

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` | Database user (default `vigilens`) |
| `POSTGRES_PASSWORD` | Database password — must be strong in production |
| `POSTGRES_DB` | Database name (default `vigilens`) |

## Production Deployment

### Vercel (Frontend + Backend)

The frontend and backend are deployed as separate Vercel projects:

- **Frontend** — static React SPA built with Vite, served via Vercel's edge
  network at `https://vigilens.vercel.app`. The `vercel.json` rewrites
  `/api/*` requests to the backend project (`vigilens-api.vercel.app`) and
  serves `index.html` for all other routes (SPA fallback). The API is always
  reached same-origin through this rewrite.
- **Backend** — serverless Express function at `https://vigilens-api.vercel.app`.
  `api/index.ts` re-exports the built Express app. The `installCommand` runs
  Prisma migrations and seed automatically during deployment. Backend CORS
  must allow the frontend origin (`https://vigilens.vercel.app`).

### Docker Compose (Full Stack)

For self-hosted deployments, Docker Compose orchestrates all four services:

```bash
cp .env.example .env   # edit with production values
docker compose up -d
```

The compose stack provides:

- **Network isolation** — PostgreSQL and AI service on an internal network
- **Resource limits** — CPU/memory pins per service
- **Health checks** — liveness and readiness probes for orchestration
- **Non-root containers** — backend and AI run as `vigilens` user (uid 1001)
- **nginx frontend** — production config with gzip, caching, SPA fallback,
  and server-side `X-Internal-Key` injection so the AI secret never reaches
  the browser

### Critical: `CAMERA_CREDENTIALS_KEY`

This key is **mandatory** in production. Without it, the backend refuses to
start and camera credential writes fail.

```bash
# Generate a 32-byte (64 hex character) key
openssl rand -hex 32
```

The key is used for AES-256-GCM authenticated encryption of camera
credentials at rest. Ciphertext is stored as `v1.<iv>.<tag>.<ciphertext>`.
If you rotate the key, set the old value as `CAMERA_CREDENTIALS_KEY_LEGACY`
so existing rows can still be decrypted.

## Security

VigiLens implements layered security controls for production use:

### Authentication & Authorization

- **JWT tokens** — HS256-signed, pinned issuer (`vigilens-api`) and audience
  (`vigilens-frontend`), configurable expiration (default 7 days). Algorithm
  is pinned to prevent `none`-algorithm attacks.
- **RBAC** — 4 roles (`super_admin`, `admin`, `operator`, `viewer`) with 36
  granular permissions enforced on every route via `requirePermission()`.
  Permission sets are cached with 30-second TTL.
- **Account lockout** — configurable `max_login_attempts` (default 5) and
  `lockout_duration_minutes` (default 15). Locked accounts are blocked at
  login and on every authenticated request.
- **Password policy** — bcrypt (12 rounds), complexity enforcement
  (uppercase + lowercase + digit + symbol), and forced-change flow.
- **Rate limiting** — global (300 req/min/IP) and auth-specific
  (20 attempts/15 min/IP).

### Credential Protection

- **Camera credentials** — AES-256-GCM encrypted at rest via
  `CAMERA_CREDENTIALS_KEY`. Ciphertext format: `v1.<iv>.<tag>.<ciphertext>`.
  Supports key rotation via `CAMERA_CREDENTIALS_KEY_LEGACY`.
- **API redaction** — camera responses strip `username`, `password`,
  `usernameEncrypted`, and `passwordEncrypted`, exposing only a
  `hasCredentials` boolean. A Prisma query extension provides a second
  layer of defense.
- **Internal API key** — machine-to-machine communication uses
  `X-Internal-Key` with constant-time comparison (`crypto.timingSafeEqual`
  on backend, `hmac.compare_digest` on AI service). The key is injected
  server-side by nginx and never reaches the browser.

### Infrastructure Security

- **CORS** — origin allowlist, no wildcards in production. The AI service
  refuses to start without explicit origins.
- **Security headers** — Helmet with CSP (`default-src 'none'`, `frame-ancestors 'none'`),
  HSTS (6 months, includeSubDomains, preload), `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` disabling geolocation/microphone/payment/USB.
- **Production startup validation** — the backend exits immediately if
  `JWT_SECRET`, `INTERNAL_API_KEY`, `CAMERA_CREDENTIALS_KEY`, or
  `DATABASE_URL` contain insecure defaults.
- **Request IDs** — UUID v4 per request, set as `X-Request-Id` response
  header and included in all error bodies for log correlation.
- **Audit logging** — 30+ action types (`user_login`, `camera_added`,
  `retention_pruned`, `incident_created`, etc.) recorded with user, IP,
  user-agent, and metadata. Non-blocking writes (failures are logged but
  never break business logic).

### Incident Investigation

Full incident lifecycle management: create from alert, status transitions
(new → acknowledged → investigating → resolved), priority changes,
assignment, investigation notes, and activity logging. All mutations are
audited and broadcast via realtime events.

## Data Retention

The retention system automatically cleans expired detection data, media files,
and generated reports.

### What is retained

- **Detection snapshots** — `image_retention_days` (default 7, range 1–365)
- **Detection recordings** — `video_retention_days` (default 30, range 1–730)
- **Generated reports** — `report_retention_days` (default 90, range 1–730)
- **Disk quota** — `max_storage_gb` (default 100, range 1–10,000) enforced
  by deleting oldest files first

### Scheduler behavior

- **Enabled by default** (`RETENTION_ENABLED` is true unless explicitly `false`)
- **Configurable interval** — `cleanup_interval_days` setting (default 1 day),
  checked every `RETENTION_TICK_MS` (default 60s)
- **Safe first run** — no immediate deletion on boot; the first pass runs
  after one full interval
- **Overlapping protection** — concurrent runs are prevented via an in-flight
  flag
- **Failure retry** — failed runs retry within 1 hour instead of waiting for
  the full interval
- **Audit trail** — every prune pass is recorded as `retention_pruned`

### Scope

Only `snapshots/`, `recordings/`, and `reports/` beneath the storage root are
ever touched. Detection database rows are purged in batches of 500 with
cascade to alerts. Incidents, audit logs, and user data are never pruned.

### Manual dry-run

```bash
cd backend
npx tsx src/scripts/pruneMedia.ts --dry-run --base /data/vigilens \
  --image-days 7 --video-days 30
```

## Health Endpoints

Both services expose unauthenticated health endpoints for orchestration
and monitoring:

| Endpoint | Service | Description |
|----------|---------|-------------|
| `GET /health/live` | Backend | Liveness — returns `ok`, uptime, version |
| `GET /health/ready` | Backend | Readiness — checks database, Prisma, AI service, storage (503 if unhealthy) |
| `GET /health` | AI Service | Full status with loaded detector details |
| `GET /health/live` | AI Service | Liveness — always 200 |
| `GET /health/ready` | AI Service | Readiness — 200 or 503 based on model loading |

## Features

- **Real-time Detection** — Process live camera streams with low latency
- **Camera Frame Capture & Snapshots** — Pull a frame from any camera type
  (RTSP/IP/HTTP streams, USB webcams and video files) through the AI `/capture`
  endpoint, persist it to storage, and view the live snapshot in the camera cards
  with a one-click capture action; each capture records a `CameraHealthLog` entry
  and a `camera_captured` audit action, and camera health checks verify
  non-HTTP feeds by capturing a real frame
- **Continuous Monitoring** — A scheduler runs the inference engine automatically
  on the cameras assigned to each enabled detector at its configured
  `detectionIntervalMs`. Frames are pulled through an AI-service `/capture`
  endpoint (RTSP/IP/HTTP streams, USB webcams and video files), each detector
  loop runs in isolation with per-loop counters, failure streaks and video-file
  position tracking, and the whole scheduler can be started/stopped from the
  UI or the API (`GET /api/monitor`, `POST /api/monitor/start|stop`) and
  auto-started at boot via `MONITOR_ENABLED`
- **Multi-model Support** — Pluggable architecture for custom detection models
- **Multi-Detector Inference Engine** — A staged pipeline (preprocess → inference →
  NMS → tracking → persistence → alerts) with measured, never-fabricated metrics,
  per-detector configuration, IoU object tracking, and alert cooldowns; only
  detectors with a real model (`person`, `vehicle`) accept inference requests
- **Dashboard & Analytics** — Recharts-powered visualizations and trends
- **System Health Monitoring** — Live `/health` probes (database, storage, AI,
  cache) plus an admin dashboard with service status cards, a resource
  (CPU/memory/disk) and request/detection metrics view, and auto-refresh
- **Production-Ready Ops** — Graceful shutdown on SIGTERM/SIGINT, request IDs
  for log correlation, centralized error handling, and hardened Docker images
- **User & Role Management** — 4 built-in roles with 36 granular permissions, a
  full users page (search, filters, sorting, pagination, status toggles,
  role assignment) and a role page with a permission editor; disabled accounts
  are blocked at login and on every request
- **Alert System** — Configurable thresholds and notification channels
- **RESTful API** — Fully documented API with Zod validation
- **Dockerized** — One-command deployment with compose

## Project Structure

```
VigiLens/
├── frontend/          # React + Vite + TypeScript + Tailwind
├── backend/           # Express + TypeScript + Prisma
├── ai/                # Python + FastAPI + YOLO
├── docker/            # Dockerfiles per service
├── docs/              # Documentation
└── .github/           # CI/CD workflows
```

## Documentation

- **[Deployment](docs/deployment.md)** — Docker Compose, hardening, and manual setup
- **[Roles & Permissions](docs/roles-and-permissions.md)** — the RBAC model, permission catalog, role matrix, and seeded accounts
- **[API](docs/api.md)** — RESTful API reference
- **[Detection Pipeline](docs/detection-pipeline.md)** — how detections flow through the engine
- **[Adding a Detector](docs/adding-a-detector.md)** — extending the detector catalog
- **[Implementation Status](docs/implementation-status.md)** — what is implemented today
- **[Limitations](docs/limitations.md)** — known limits and constraints

## License

MIT
