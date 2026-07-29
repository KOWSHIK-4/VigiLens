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

## AI Service

```bash
POST /detect/image   # multipart/form-data with image file
POST /detect/video   # multipart/form-data with video file
GET  /health
```
