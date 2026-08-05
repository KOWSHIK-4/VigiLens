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

## Users & Roles (RBAC)

Access to every resource is governed by role-based permissions. The database is
seeded with 20 permissions across 8 categories and 4 roles: `super_admin`
(full access), `admin` (manage users, cameras and models), `operator`
(monitor cameras, detections and alerts) and `viewer` (read-only). Accounts
with status `disabled` cannot log in (401). Seed accounts (password
`admin123`): `super@vigilens.io`, `admin@vigilens.io`, `operator@vigilens.io`,
`viewer@vigilens.io`, `disabled@vigilens.io`.

```bash
GET    /users?page=1&limit=10&search=jane&role=admin&status=active&sortBy=name&sortOrder=asc
GET    /users/stats                          # total, active, disabled, online
GET    /users/:id
POST   /users                                # create a user (email must be unique)
PATCH  /users/:id                            # update name / avatar
PATCH  /users/:id/role                       # { "role": "operator" }
PATCH  /users/:id/status                     # { "status": "disabled" }
PATCH  /users/:id/password                   # { "password": "newpass123" } (requires users.reset_password)
DELETE /users/:id                            # self-delete and last super-admin are blocked
```

Role management:

```bash
GET    /roles                                # roles with permissions and user counts
PATCH  /roles/:name/permissions              # { "permissionKeys": ["cameras.read", "..."] }
```

- Disabled accounts are rejected with 403 on every authenticated request.
- Editing `super_admin` permissions is always blocked (400).
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

## AI Service

```bash
POST /detect/image   # multipart/form-data with image file
POST /detect/video   # multipart/form-data with video file
GET  /health
```
