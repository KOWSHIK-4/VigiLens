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
- **Multi-model Support** — Pluggable architecture for custom detection models
- **Dashboard & Analytics** — Recharts-powered visualizations and trends
- **User Management** — JWT authentication with role-based access
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
