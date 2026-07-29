# Deployment

## Docker Compose (Recommended)

```bash
cp .env.example .env
docker compose up -d
```

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
