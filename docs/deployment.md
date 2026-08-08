# Deployment

## Docker Compose (Recommended)

```bash
cp .env.example .env
docker compose up -d
```

The compose stack hardens production behavior:

- **Resource limits** — each service pins CPU/memory via `cpus`/`mem_limit`.
- **Health checks** — backend uses `/health/live`, AI service uses `/health`.
- **Storage** — the backend data volume is mounted at `/data/vigilens` and
  created with the correct ownership (`mkdir -p /data/vigilens` in the image)
  so the service runs as a non-root user.
- **nginx** — the frontend ships a production `nginx.conf` (gzip, caching,
  SPA fallback) instead of relying on the dev server.

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
