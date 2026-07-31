# API Reference

## Base URL

- Development: `http://localhost:4000/api`
- Production: `/api`

## Authentication

Register a new user:

```bash
POST /auth/register
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "password": "securepassword"
}
```

Login:

```bash
POST /auth/login
{
  "email": "jane@example.com",
  "password": "securepassword"
}
```

All subsequent requests require the `Authorization: Bearer <token>` header.

## Detections

```bash
GET /detections?page=1&limit=20&status=critical
GET /detections/stats
GET /detections/:id
```

## Cameras

```bash
GET /cameras
GET /cameras/:id
```

## AI Models

Manage detection models independently of cameras. Model statuses: `loaded`, `loading`, `disabled`, `error`.

```bash
GET   /models?page=1&limit=20&search=fire&status=loaded&enabled=true&sortBy=name&sortOrder=asc
GET   /models/:id
PATCH /models/:id
POST  /models/:id/load
POST  /models/:id/unload
POST  /models/:id/test
```

PATCH body (all fields optional):

```json
{
  "name": "Person Detection",
  "version": "2.0.0",
  "description": "Updated description",
  "confidenceThreshold": 62,
  "enabled": true,
  "gpuSupported": true,
  "modelPath": "/models/person/yolo11n.pt"
}
```

## AI Service

```bash
POST /detect/image   # multipart/form-data with image file
POST /detect/video   # multipart/form-data with video file
GET  /health
```
