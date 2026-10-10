# AGENTS.md

This file provides guidance for AI agents working in this repository.

## Project structure
- rontend/ - React + Vite + TypeScript app
- ackend/ - Express + TypeScript + Prisma API
- i/ - FastAPI + Ultralytics YOLO service
- docker/ - Docker configs
- docs/ - Documentation

## Common commands

### Frontend
```bash
cd frontend
npm install
npm run dev
npm run lint
npm run build
npm test
```

### Backend
```bash
cd backend
npm install
npx prisma migrate dev
npm run dev
npm run build
npm run lint
npm test
```

### AI service
```bash
cd ai
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Docker
```bash
docker compose up -d
docker compose down
```

## Conventions
- Follow existing code style; avoid adding comments unless requested.
- Run lint and typecheck/build if available.
- Never commit secrets (.env files).
