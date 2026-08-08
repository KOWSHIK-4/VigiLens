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

Login returns `{ token, user }`. After 5 consecutive failed attempts the
account is locked (`isLocked: true`, `lockedAt` set); locked accounts get `403`
on login until an admin unlocks them via `POST /users/:id/unlock`.

Additional auth endpoints (all require the Bearer token unless noted):

```bash
POST /auth/logout            # blacklists the token, writes user_logout audit
GET  /auth/me                # current user profile + effective permissions
POST /auth/change-password   # { "currentPassword", "newPassword" }
```

- `POST /auth/change-password` requires a valid current password. It clears
  `mustChangePassword`, `isLocked` and the failed-login counter.
- When a user's `mustChangePassword` flag is set (e.g. after an admin password
  reset), every authenticated request except `/auth/change-password`,
  `/auth/me` and `/auth/logout` is rejected with `403`
  `{ "code": "PASSWORD_CHANGE_REQUIRED" }`.

All subsequent requests require the `Authorization: Bearer <token>` header.

## Users & Roles (RBAC)

Access to every resource is governed by role-based permissions. The database is
seeded with 31 permissions across 10 categories and 4 roles: `super_admin`
(full access), `admin` (manage users, cameras, models and settings),
`operator` (monitor cameras, detections and alerts) and `viewer` (read-only).
Custom roles can be created and assigned. Accounts with status `disabled`
cannot log in. Seed accounts (password `password123`):
`super@vigilens.io`, `admin@vigilens.io`, `operator@vigilens.io`,
`viewer@vigilens.io`, `disabled@vigilens.io`.

```bash
GET    /users?page=1&limit=10&search=jane&role=admin&status=active&sortBy=name&sortOrder=asc
GET    /users/stats                          # total, active, disabled, online, locked
GET    /users/:id
POST   /users                                # create a user (email must be unique)
PATCH  /users/:id                            # update name / avatar / role
PATCH  /users/:id/role                       # { "role": "operator" }
PATCH  /users/:id/status                     # { "status": "disabled" | "active" }
POST   /users/:id/lock                       # lock account (blocks login)
POST   /users/:id/unlock                     # clear lock and failed attempts
POST   /users/:id/reset-password             # { "password": "newpass123", "mustChangePassword": true }
DELETE /users/:id                            # soft delete (deletedAt set, login blocked)
```

Role management:

```bash
GET    /roles                                # roles with permissions and user counts
GET    /roles/permissions                    # all permission definitions
POST   /roles                                # { "name": "security_manager", "description": "..." }
PATCH  /roles/:name                          # { "description": "..." }
PATCH  /roles/:name/permissions              # { "permissionKeys": ["cameras.read", "..."] }
DELETE /roles/:name                          # delete a custom role
```

- Disabled, soft-deleted and locked accounts are rejected with 403 on every
  authenticated request.
- Editing or deleting `super_admin` is always blocked (400). System roles
  (`admin`, `operator`, `viewer`) cannot be deleted.
- Deleting a role is rejected with 400 while active users reference it; any
  soft-deleted users still assigned are moved to `viewer` first.
- Permission changes take effect immediately (per-role cache is invalidated).

## Reports

```bash
GET    /reports?page=1&limit=10&type=daily&status=completed
GET    /reports/:id
GET    /reports/download/:id
POST   /reports/generate     # requires reports.manage
DELETE /reports/:id          # requires reports.manage
```

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

## System Settings

Application configuration is grouped into 8 categories: `general`, `security`,
`ai_detection`, `notifications`, `cameras`, `storage`, `email`, `backup`.
Every setting ships with a default that is seeded on first startup, is
validated against its type/range/options, and is cached in memory. Every
change is written to the audit log (`settings_changed`) and is restricted to
administrators (`settings.read` / `settings.manage`).

```bash
GET    /settings                          # all settings across every category
GET    /settings/:category                # settings for one category
PATCH  /settings/:category                # update one or more settings
POST   /settings/:category/reset          # restore the category to defaults
```

A setting row looks like:

```json
{
  "key": "global_confidence_threshold",
  "category": "ai_detection",
  "label": "Global confidence threshold",
  "description": "Detections below this confidence are ignored across all detectors.",
  "type": "number",
  "value": 50,
  "min": 0,
  "max": 100,
  "step": 1,
  "unit": "%",
  "updatedAt": "2026-08-06T12:00:00.000Z",
  "updatedBy": "62f7375d-7cd3-4b63-930d-2b7e3fc9843d"
}
```

`type` is one of `boolean`, `number`, `string`, `select`, `color`. `select`
settings include an `options` array, number settings include `min`/`max`/`step`
/`unit` where applicable, and `color` settings accept `#rrggbb` values.

PATCH /settings/:category body (each key must exist in that category):

```json
{
  "session_timeout_minutes": 45,
  "max_login_attempts": 7
}
```

Notable settings:

- **AI Detection**: `global_confidence_threshold` (0–100), `default_detector`,
  `preferred_processor` (`auto`|`gpu`|`cpu`), `detection_fps` (1–60),
  `image_retention_days`, `video_retention_days`, `snapshot_quality` (10–100),
  `auto_cleanup_enabled`.
- **Security**: `session_timeout_minutes`, `password_min_length`,
  `password_require_complexity`, `max_login_attempts`, `lockout_duration_minutes`,
  `rate_limit_window_ms`, `rate_limit_max_requests`, `jwt_expiration_hours`,
  `jwt_require_https`.
- **Notifications**: `email_alerts_enabled`, `critical_alert_enabled`,
  `warning_alert_enabled`, `daily_summary_enabled`, `weekly_report_enabled`,
  `digest_time`.
- **Cameras**: `default_capture_fps`, `max_connected_cameras`,
  `camera_reconnect_timeout_seconds`, `thumbnail_refresh_seconds`.
- **Storage**: `storage_base_path`, `max_storage_gb`, `low_storage_threshold_gb`,
  `cleanup_interval_days`.
- **Email**: `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_username`,
  `smtp_from_email`, `notifications_email`.
- **Backup**: `auto_backup_enabled`, `backup_interval_days`, `backup_time`,
  `backup_retention_count`.

## AI Detector Marketplace

Install, configure, and monitor detection detectors. Detector statuses: `running`, `stopped`, `error`. A detector is `running` when it is loaded and enabled; `error` when the engine is in an error state; `stopped` otherwise. After a restart the detector transitions through `loading` until it reports healthy.

The marketplace ships 14 detector definitions across 6 categories. 8 are auto-installed on seed: Person Detection, Fire Detection, Smoking Detection, Helmet Detection, Face Mask Detection, Vehicle Detection, Intrusion Detection, and Drowsiness Detection. The remaining 6 (Weapon Detection, Abandoned Object Detection, PPE Detection, Crowd Detection, Violence Detection, License Plate Detection) are available for manual install.

```bash
GET    /detectors/marketplace          # all definitions + installed flag
GET    /detectors/categories           # available category chips
GET    /detectors?page=1&limit=20&search=fire&status=running&category=safety&sortBy=name&sortOrder=asc
GET    /detectors/:id
GET    /detectors/:id/health           # engine health + settings + cameras
POST   /detectors                      # install a detector from the marketplace
PATCH  /detectors/:id/enable           # enable a detector
PATCH  /detectors/:id/disable          # disable a detector
PATCH  /detectors/:id/settings         # update alert severity / interval / processor
PUT    /detectors/:id/cameras          # assign monitored cameras
POST   /detectors/:id/restart          # restart the detector engine
DELETE /detectors/:id                  # uninstall the detector
```

POST /detectors body:

```json
{
  "detectorKey": "weapon"
}
```

PATCH /detectors/:id/settings body (all fields optional):

```json
{
  "alertSeverity": "critical",
  "detectionIntervalMs": 5000,
  "preferredProcessor": "gpu"
}
```

`alertSeverity`: `info` | `warning` | `critical`. `preferredProcessor`: `gpu` | `cpu` | `auto`. `detectionIntervalMs` must be between 1000 and 60000.

PUT /detectors/:id/cameras body:

```json
{
  "cameraIds": ["demo-camera-1", "demo-camera-2"]
}
```

POST /detectors/:id/restart marks the detector as `loading`, then flips it to `loaded` (and `running` when enabled) after the engine warm-up delay. Restarting a disabled detector is rejected with 400.

## Inference Engine (v2)

The inference engine is a multi-stage pipeline: frame capture → preprocessing →
detector selection → inference (AI service) → post-processing (confidence filter +
per-class NMS) → object tracking (IoU) → normalization → persistence → alert
evaluation (with per-detector/camera/class cooldown). Every stage runs against
real data; metrics are measured with `process.hrtime`, never fabricated.

Engine endpoints require `models.read` (reads) and `models.manage` (process):

```bash
GET    /engines                         # runtime descriptors for all detectors
GET    /engines/:key                    # descriptor for one detector
GET    /engines/:key/metrics            # measured pipeline metrics (real runs only)
GET    /engines/:key/detections?limit=25 # recent persisted detections for a detector
POST   /engines/:key/process            # run inference on an uploaded image
```

A descriptor looks like:

```json
{
  "id": "clx...",
  "key": "person",
  "name": "Person Detection",
  "type": "object_detection",
  "version": "1.0.0",
  "status": "ready",
  "availability": "available",
  "confidenceThreshold": 50,
  "supportedInput": ["image"],
  "modelVersion": "1.0.0",
  "configuration": {
    "confidenceThreshold": 50,
    "detectionIntervalMs": 1000,
    "maxDetectionsPerFrame": 20,
    "alertSeverity": "warning",
    "alertCooldownMs": 5000,
    "cameraIds": ["demo-camera-1"],
    "inputResolution": "640x640",
    "processingMode": "auto"
  }
}
```

`availability` is `available` only when the detector has a real model wired to the
AI service (`person` and `vehicle` today). All other detectors are `unconfigured`
and refuse inference — the engine never fabricates detections.

`POST /engines/:key/process` accepts `multipart/form-data` with an `image` file
(and an optional `camera_id`; when omitted the first camera is used so persisted
detections satisfy the foreign key). Response:

```json
{
  "key": "person",
  "cameraId": "demo-camera-1",
  "detections": [
    {
      "id": "clx...",
      "className": "person",
      "confidence": 0.88,
      "bbox": { "x1": 214, "y1": 96, "x2": 328, "y2": 398 },
      "normalized": { "x": 0.33, "y": 0.15, "width": 0.18, "height": 0.47 },
      "trackId": "0",
      "detectorKey": "person",
      "processingTimeMs": 84.2,
      "timestamp": "2026-08-08T10:00:00.000Z"
    }
  ],
  "count": 1,
  "metrics": {
    "framesProcessed": 1,
    "framesSkipped": 0,
    "inferenceTimeMs": 82.1,
    "totalProcessingTimeMs": 88.4,
    "detectionsPerFrame": 1,
    "lastDetectionAt": "2026-08-08T10:00:00.000Z",
    "lastFrameAt": "2026-08-08T10:00:00.000Z",
    "errorCount": 0
  },
  "processedAt": "2026-08-08T10:00:00.000Z"
}
```

Engine errors are explicit and never faked:

- `404` unknown detector key
- `501` `{ "code": "DETECTOR_UNCONFIGURED" }` — detector has no trained model
- `409` `{ "code": "DETECTOR_DISABLED" }` — detector is disabled
- `502` `{ "code": "DETECTOR_INFERENCE_FAILED" }` — AI service error/unreachable

## AI Service

```bash
POST /detect/image   # multipart/form-data with image file
POST /detect/video   # multipart/form-data with video file
GET  /health
```

## Health Checks

Health endpoints are public (no authentication) and designed for load
balancers, orchestrators, and uptime monitors.

| Endpoint        | Auth | Description                                                        |
|-----------------|------|--------------------------------------------------------------------|
| `GET /health/live`    | No  | Liveness probe — returns `200 { status: "ok" }` once the process is up. |
| `GET /health/ready`   | No  | Readiness probe — aggregates all dependency checks (database, storage, AI, cache, Redis). |
| `GET /health/ai`      | No  | AI service health, version, uptime, and detection latency. |
| `GET /health/cache`   | No  | Cache health (Redis). |
| `GET /health/storage` | No  | Storage path, writability probe, free/total space, and usage percentage. |
| `GET /health/redis`   | No  | Redis health detail (`not_configured` when no Redis URL is set). |

Readiness response example:

```json
{
  "status": "degraded",
  "checks": {
    "database": { "status": "up", "version": "PostgreSQL 16.4" },
    "storage": {
      "status": "up",
      "path": "/data/vigilens",
      "freeBytes": 482344960000,
      "totalBytes": 1024 }
  },
  "timestamp": "2026-08-08T10:00:00.000Z"
}
```

Each service reports `status` of `up` / `down` / `not_configured`; the overall
status is `ok` only when every configured service is `up`.

## System Monitoring

These endpoints require a JWT and the `monitoring.read` permission (granted to
`admin` and `super_admin` roles by default).

```bash
GET /api/system/health     # overall + per-service status, hostname, uptime, timestamp
GET /api/system/resources  # cpu (percent), memory (used/total), disk (used/total/free)
GET /api/system/metrics    # in-memory request and detection counters
```

`GET /api/system/metrics` returns a live snapshot of the current process:

```json
{
  "requests": {
    "total": 1240,
    "perMinute": 58,
    "byRoute": { "GET /api/system/health": 3 }
  },
  "detections": {
    "total": 8712,
    "perMinute": 133,
    "bySeverity": { "info": 6100, "warning": 2104, "critical": 508 }
  },
  "uptimeSeconds": 86400,
  "timestamp": "2026-08-08T10:00:00.000Z"
}
```

## Request Context & Errors

Every request is assigned a `X-Request-Id` header (echoed in responses) that is
also returned as `requestId` in error bodies for correlation with logs.

All errors share a uniform shape:

```json
{
  "statusCode": 404,
  "message": "Route not found",
  "requestId": "7f9c...",
  "timestamp": "2026-08-08T10:00:00.000Z"
}
```

Unknown routes return `404 Route not found`; validation errors return `400`
with the failing fields.
