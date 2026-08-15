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
git clone https://github.com/yourorg/vigilens.git
cd vigilens

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
  UI or the API (`GET|POST /api/monitor`, `GET /api/monitor/start|stop`) and
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
- **User & Role Management** — 4 built-in roles with 34 granular permissions, a
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

## License

MIT
