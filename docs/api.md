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

The database is seeded with 8 default models: Person Detection, Fire Detection, Smoking Detection, Helmet Detection, Face Mask Detection, Vehicle Detection, Intrusion Detection, and Drowsiness Detection. The first model (Person Detection) is kept as the default active model.

```bash
GET    /models?page=1&limit=20&search=fire&status=loaded&enabled=true&sortBy=name&sortOrder=asc
GET    /models/active                 # currently active model
GET    /models/:id
POST   /models                        # create a model
PATCH  /models/:id                    # update a model
PATCH  /models/:id/enable             # enable a model
PATCH  /models/:id/disable            # disable a model
PATCH  /models/:id/threshold          # update confidence threshold
DELETE /models/:id                    # delete a model
POST   /models/:id/load
POST   /models/:id/unload
POST   /models/:id/test
```

POST /models body:

```json
{
  "name": "Fire Detection",
  "version": "1.0.0",
  "detectorKey": "fire",
  "description": "Detects fire and open flames",
  "confidenceThreshold": 45,
  "enabled": true,
  "gpuSupported": true,
  "modelPath": "/models/fire/fire.pt"
}
```

PATCH /models/:id body (all fields optional):

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

PATCH /models/:id/threshold body:

```json
{
  "confidenceThreshold": 62
}
```

## AI Service

```bash
POST /detect/image   # multipart/form-data with image file
POST /detect/video   # multipart/form-data with video file
GET  /health
```
