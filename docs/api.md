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
seeded with 33 permissions across 12 categories and 4 roles: `super_admin`
(full access), `admin` (manage users, cameras, models and settings),
`operator` (monitor cameras, detections and alerts) and `viewer` (read-only).
Custom roles can be created and assigned. Accounts with status `disabled`
cannot log in. Seed accounts (password `admin123`):
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
DELETE /detections/:id              # requires detections.manage (also removes the linked alert)
```

Detections are read-only for `viewer`/`operator` (require `detections.read`). Deleting a detection additionally requires `detections.manage` (granted to `admin` and `super_admin`) and records a `detection_deleted` audit action. Deleting an unknown id returns `404`.

## Cameras

```bash
GET /cameras
GET /cameras/:id
POST /cameras/:id/capture          # capture a frame snapshot (cameras.control)
GET /cameras/:id/thumbnail         # stream the latest snapshot as image/jpeg (cameras.read)
```

Camera views require `cameras.read`; creating/editing/deleting cameras requires
`cameras.manage`; start/stop and snapshot capture require `cameras.control`.

`POST /cameras/:id/capture` pulls one frame from the camera's feed through the AI
service `/capture` endpoint (RTSP/IP/HTTP streams, USB webcams and video files),
persists it to `snapshots/<cameraId>.jpg` under the configured `storage_base_path`,
updates the camera row (`thumbnail`, `lastSnapshotAt`, status, health), writes a
`CameraHealthLog` entry and records a `camera_captured` audit action. A missing
camera returns `404`; an unreachable or timed-out AI service returns `502` with a
machine-readable code (`AI_SERVICE_UNREACHABLE`, `AI_SERVICE_TIMEOUT`,
`AI_CAPTURE_FAILED`).

`GET /cameras/:id/thumbnail` streams the latest captured frame as `image/jpeg`.
It requires authentication, so the browser must fetch it as an authenticated blob
(not a plain `<img>` tag) and returns `404` before the first capture.

The health check (`POST /cameras/:id/health`) probes IP/HTTP cameras with a HEAD
request and verifies RTSP/USB/video-file feeds by capturing a real frame through
the AI service.

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

Install, configure, and monitor detection detectors. Every detector exposes two status surfaces:

- `status` — legacy 3-state (`running` | `stopped` | `error`), kept for backwards compatibility.
- `runtimeStatus` — honest 9-state lifecycle derived from durable and measured engine facts: `registered`, `configured`, `enabled`, `disabled`, `loading`, `ready`, `error`, `unavailable`, `unconfigured`. A detector is only ever `ready` after a real live inference has succeeded; it is `unconfigured` when no trained model is wired to the AI service, and `unavailable` when the AI backend is unreachable.

The marketplace ships 14 detector definitions across 6 categories. 8 are auto-installed on seed: Person Detection, Fire Detection, Smoking Detection, Helmet Detection, Face Mask Detection, Vehicle Detection, Intrusion Detection, and Drowsiness Detection. The remaining 6 (Weapon Detection, Abandoned Object Detection, PPE Detection, Crowd Detection, Violence Detection, License Plate Detection) are available for manual install.

Detector rows also carry `type` (`object_detection` | `classification` | `segmentation`) and `supportedInput` (`image` | `video` | `webcam`), which drive the camera assignment validation described below.

```bash
GET    /detectors/marketplace          # all definitions + installed flag
GET    /detectors/categories           # available category chips
GET    /detectors?page=1&limit=20&search=fire&status=ready&type=object_detection&enabled=true&category=safety&sortBy=name&sortOrder=asc
GET    /detectors/:id
GET    /detectors/:id/health           # engine health + settings + cameras
POST   /detectors                      # install a detector from the marketplace
PATCH  /detectors/:id                  # update name / description / version / enabled
PATCH  /detectors/:id/enable           # enable a detector
PATCH  /detectors/:id/disable          # disable a detector
PATCH  /detectors/:id/settings         # update severity / interval / cooldown / threshold / processor
PUT    /detectors/:id/cameras          # assign monitored cameras (with per-camera enable)
POST   /detectors/:id/restart          # restart the detector engine
DELETE /detectors/:id                  # uninstall the detector
```

`GET /detectors` accepts `status` in either vocabulary (legacy `running`/`stopped`/`error` or any `runtimeStatus` value), plus `type`, `enabled` (`true`/`false`), `search`, `category`, `sortBy` (including `version`) and `sortOrder`.

POST /detectors body:

```json
{
  "detectorKey": "weapon"
}
```

PATCH /detectors/:id body (at least one field required):

```json
{
  "name": "Fire Detection PRO",
  "version": "2.4.0",
  "description": "Updated description",
  "enabled": true
}
```

PATCH /detectors/:id/settings body (all fields optional):

```json
{
  "confidenceThreshold": 65,
  "alertSeverity": "critical",
  "detectionIntervalMs": 5000,
  "alertCooldownMs": 30000,
  "preferredProcessor": "gpu"
}
```

`alertSeverity`: `info` | `warning` | `critical`. `preferredProcessor`: `gpu` | `cpu` | `auto`. `detectionIntervalMs` must be between 100 and 3600000 (default 5000). `alertCooldownMs` is the minimum time between alerts for the same detector (0 disables the cooldown; default 30000).

PUT /detectors/:id/cameras accepts either a plain list of camera ids, or per-camera assignments with an enable flag (assign a feed but pause detection on it without removing it):

```json
{
  "assignments": [
    { "cameraId": "demo-camera-1", "enabled": true },
    { "cameraId": "demo-camera-2", "enabled": false }
  ]
}
```

```json
{
  "cameraIds": ["demo-camera-1", "demo-camera-2"]
}
```

Camera ids must be unique, existing cameras, and each camera's feed type must be compatible with the detector's `supportedInput` (webcam feeds map to `webcam`, RTSP/IP/video-file feeds map to `video`). Incompatible assignments are rejected with 400.

POST /detectors/:id/restart marks the detector as `loading`, then flips it to `loaded` (and `running` when enabled) after the engine warm-up delay. Restarting a disabled detector is rejected with 400.

All detector management actions (`detector_created`, `detector_updated`, `detector_deleted`, `detector_enabled`, `detector_disabled`, `detector_config_updated`, `detector_cameras_updated`) are recorded in the audit log.

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

`POST /engines/:key/process-live` runs one-shot inference on a camera source
without an image upload. Query/body: `camera_id` (required), optional
`video_pos_seconds`, optional `force=true`. The engine captures a fresh frame
from the camera through the AI service `/capture` endpoint, then runs the full
pipeline. The response mirrors `process` and adds `latencyMs` (measured
end-to-end) and `source`:

```json
{
  "key": "person",
  "cameraId": "demo-camera-1",
  "source": { "cameraType": "rtsp", "videoPosSeconds": 0 },
  "latencyMs": 912.4,
  "count": 2,
  "detections": [],
  "metrics": { "framesProcessed": 1, "totalProcessingTimeMs": 900.2, "errorCount": 0 },
  "processedAt": "2026-08-16T21:30:00.000Z"
}
```

## AI Service

```bash
POST /detect/image   # multipart/form-data with image file[&detector=&confidence=0..1]
POST /detect/video   # multipart/form-data with video file[&detector=&confidence=0..1]
GET  /detect/webcam  # ?camera_id=&detector=&device=&confidence=0..1 (MJPEG stream)
GET  /detect/webcam/stats  # ?camera_id=&detector= (per-stream stats)
GET  /capture        # ?source=<url|path>&type=usb|rtsp|ip|video_file[&video_pos_seconds=0]
GET  /health
```

`detector` selects the model (`person_detector`, `vehicle_detector`, or a
registered detector name); `confidence` overrides the confidence floor (0..1,
default 0.5) for the call and is validated (`422` outside the range).

`GET /capture` grabs a single JPEG frame from a camera source. `type` selects
how the source is opened: `usb` (device path like `/dev/video0`), `rtsp` / `ip`
(stream URL passed to OpenCV verbatim) or `video_file` (path, resolved against
`MEDIA_ROOT` when relative). `video_pos_seconds` seeks a video file before
reading. Returns `image/jpeg` with `Cache-Control: no-store`; `400` for an
unsupported type and `502` when the source cannot be opened or yields no frame.

## Health Checks

Health endpoints are public (no authentication) and designed for load
balancers, orchestrators, and uptime monitors.

| Endpoint          | Auth | Description                                                        |
|-------------------|------|--------------------------------------------------------------------|
| `GET /health`     | No  | Liveness probe — returns `200 { status: "ok", service: "vigilens-api", ... }` once the process is up. |
| `GET /health/live`| No  | Alias of the liveness probe. |
| `GET /health/ready` | No  | Readiness probe — runs dependency checks for PostgreSQL, Prisma, AI, storage and Redis and returns an overall status. |

Readiness response example:

```json
{
  "status": "degraded",
  "services": [
    { "name": "postgres", "label": "PostgreSQL", "status": "healthy", "responseTimeMs": 2, "version": "PostgreSQL 16.4", "detail": "vigilens" },
    { "name": "prisma", "label": "Prisma ORM", "status": "healthy", "responseTimeMs": 1 },
    { "name": "ai", "label": "AI Service", "status": "offline", "responseTimeMs": 3002, "detail": "fetch failed" },
    { "name": "storage", "label": "Storage", "status": "healthy", "responseTimeMs": 4, "detail": "/data/vigilens (448.8 GB free of 1024.0 GB)" },
    { "name": "redis", "label": "Redis / Cache", "status": "not_configured", "responseTimeMs": 0, "detail": "Redis cache is not configured" }
  ],
  "responseTimeMs": 3003,
  "timestamp": "2026-08-08T10:00:00.000Z",
  "version": "1.1.0",
  "uptime": 120
}
```

Each service reports `status` of `up` / `down` / `not_configured`; the overall
status is `ok` only when every configured service is `up`.

## System Monitoring

These endpoints require a JWT and the `monitoring.read` permission (granted to
`admin` and `super_admin` roles by default).

```bash
GET /api/system/health      # overall + per-service status, hostname, uptime, timestamp
GET /api/system/monitoring  # resource snapshot: cpu (percent/cores), memory (used/total), disk (used/free/mount)
GET /api/system/metrics     # in-memory request and detection counters
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

## Continuous Monitoring

The monitoring scheduler runs the inference engine automatically on the
cameras assigned to each enabled detector at its configured
`detectionIntervalMs`. Frames are pulled from the AI service `/capture`
endpoint, so the scheduler works for RTSP/IP/USB streams and video files
without any browser involvement.

`GET` endpoints require `monitoring.read`; `POST` endpoints require
`monitoring.manage` (both granted to `admin` and `super_admin` by default).

```bash
GET  /api/monitor         # scheduler status + loop list
POST /api/monitor/start   # start the scheduler (idempotent)
POST /api/monitor/stop    # stop the scheduler (idempotent)
```

Start/stop actions are written to the audit log as `monitor_started` /
`monitor_stopped`. The scheduler auto-starts at boot when `MONITOR_ENABLED=true`
(`MONITOR_TICK_MS` controls how often the loop list is re-evaluated, default
`1000`).

`GET /api/monitor` response shape:

```json
{
  "running": true,
  "startedAt": "2026-08-14T10:00:00.000Z",
  "stoppedAt": null,
  "tickMs": 1000,
  "loopCount": 2,
  "framesProcessed": 12,
  "detectionsCreated": 3,
  "errorCount": 0,
  "lastTickAt": "2026-08-14T10:00:05.000Z",
  "nextTickAt": "2026-08-14T10:00:06.000Z",
  "loops": [
    {
      "id": "359cb417-...::demo-camera-1",
      "detectorId": "359cb417-...",
      "detectorKey": "person",
      "detectorName": "Person Detection",
      "camera": { "id": "demo-camera-1", "name": "Main Entrance", "url": "rtsp://camera-stream", "cameraType": "rtsp" },
      "intervalMs": 5000,
      "status": "ok",
      "nextRunAt": "2026-08-14T10:00:07.000Z",
      "lastRunAt": "2026-08-14T10:00:05.000Z",
      "lastSuccessAt": "2026-08-14T10:00:05.000Z",
      "framesProcessed": 6,
      "detectionsCreated": 2,
      "errorCount": 0,
      "consecutiveFailures": 0,
      "lastError": null,
      "lastErrorAt": null,
      "lastProcessingTimeMs": 340,
      "videoPosSeconds": 0
    }
  ]
}
```

Only loops whose detector has a real AI model (`person`, `vehicle`), is
`enabled` and `loaded`, and has at least one enabled camera assignment are
listed. `status` is `idle` → `running` → `ok`/`error` per loop; failures are
isolated per loop, and `videoPosSeconds` advances for `video_file` cameras so
consecutive captures move forward through the recording instead of re-reading
frame 0.

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
