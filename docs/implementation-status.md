# Implementation Status

Status of every VigiLens capability against the three-tier rubric:

- **IMPLEMENTED** — fully built, tested and wired end to end.
- **ARCHITECTURE READY** — designed in the engine/pipeline and partially wired;
  needs a trained model or external service to light up.
- **MODEL NOT AVAILABLE** — the code path exists and the UI/API surface is
  present, but no trained model is shipped; it will refuse (not fabricate) work.

## Platform

| Capability | Status | Notes |
|-----------|--------|-------|
| Auth + JWT + RBAC permissions | IMPLEMENTED | Users, roles, permission middleware, lockout, audit trail |
| API validation & abuse protection | IMPLEMENTED | zod schemas on every route, layered rate limits (300/min global, 20/15min auth), camera credential redaction, CSV formula-injection guard |
| Camera management | IMPLEMENTED | CRUD, health probing, frame capture, snapshots |
| Detection history | IMPLEMENTED | CRUD, stats, CSV export, per-detector feed |
| Alerts + cooldown | IMPLEMENTED | Engine `CooldownAlertStage` + ingestion dedup |
| Analytics & reports | IMPLEMENTED | Trends, per-camera/per-detector stats |
| System monitoring | IMPLEMENTED | Health endpoints, scheduler status, metrics |
| Frontend (15 pages) | IMPLEMENTED | Live camera, models, detectors, cameras, detections, analytics, reports, monitoring, audit, settings, users, RBAC |
| CI pipelines | IMPLEMENTED | Backend + AI checks in GitHub Actions |

## Real-time detection engine

| Capability | Status | Notes |
|-----------|--------|-------|
| Pipeline stages (capture→preprocess→inference→postprocess→tracking→normalize→persist→alerts) | IMPLEMENTED | `backend/src/engine/` |
| Confidence threshold per detector (backend → AI) | IMPLEMENTED | Forwarded as `confidence` query param, validated 0..1 |
| Persistent cross-frame tracking | IMPLEMENTED | Per-`(detector, camera)` tracker, reset on restart/reconnect |
| Engine metrics / health | IMPLEMENTED | Real measured values only |
| `POST /engines/:key/process` (uploaded image) | IMPLEMENTED | Multer image upload |
| `POST /engines/:key/process-live` (camera source) | IMPLEMENTED | Capture-on-demand via AI `/capture` |
| Continuous monitor scheduler | IMPLEMENTED | Per-loop state + status API |
| Model test honesty | IMPLEMENTED | Real probe or explicit `unavailable` |

## Detectors

| Detector | Backend key | AI model | Status |
|----------|-------------|----------|--------|
| Person detection | `person` | `person_detector` | IMPLEMENTED — `yolo11n.pt` bundled in repo, real YOLO inference |
| Vehicle detection | `vehicle` | `vehicle_detector` | IMPLEMENTED — `yolo11n.pt` with COCO class filter [car, motorcycle, bus, truck] |
| Any other key | — | — | MODEL NOT AVAILABLE — reported `unconfigured`, engine refuses with `501 DETECTOR_UNCONFIGURED` |

### Detector lifecycle

| Status | Meaning |
|--------|---------|
| `registered` | Installed model row exists |
| `configured` | Loaded + enabled, inference not yet verified |
| `disabled` | Turned off by a user |
| `loading` | Weights loading |
| `ready` | Loaded + at least one successful inference |
| `error` | Load failed or repeated inference failures |
| `unavailable` | AI inference backend unreachable |
| `unconfigured` | No trained model installed |

## Webcam live stream

| Capability | Status | Notes |
|-----------|--------|-------|
| Multi-detector stream (`/detect/webcam?detector=`) | IMPLEMENTED | Backend key ↔ AI model mapping |
| Per-stream stats | IMPLEMENTED | `stream_stats` registry keyed by `(camera_id, detector)` |
| Reconnect on read failure | IMPLEMENTED | 3 attempts, 1 s delay, tracker reset |
| Device selection (`device=`) | IMPLEMENTED | Index, `videoN` or platform path |
| Ingestion to backend | IMPLEMENTED | `X-Internal-Key` guard, alert cooldown, `skip_alert` |

## Known non-goals

- No face recognition / attribute models (labels come from YOLO classes).
- No GPU-resident model weights committed to the repository (CPU inference only; GPU is a scheduling hint).
- No distributed streaming (single-PC capture); see `limitations.md`.
