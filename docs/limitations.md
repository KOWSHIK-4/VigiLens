# Known Limitations

Honest list of what VigiLens does and does not do in its current form.

## Models

- **Bundled model weights.** The repo ships `yolo11n.pt` (YOLOv11-nano,
  ~5.5 MB) at `ai/yolo11n.pt`. The Docker build copies it into the
  container and the AI service loads it automatically. Heavier models
  (e.g. YOLOv11-medium) can be swapped by replacing the file or
  mounting a different path.
- Only object-detection-style detectors exist (`person`, `vehicle`). There
  are no classification or segmentation models, and no face recognition.
- Labels come from YOLO class names; a `vehicle` box labeled `car` is
  expected behavior for the YOLO COCO-class model.

## Runtime

- Inference is performed by a single Python AI service; capture and
  inference are not distributed across machines.
- GPU vs CPU execution follows the `preferredProcessor` setting; the
  backend does not enforce the choice — it is a scheduling hint.
- The monitor scheduler runs in-process. Restarting the backend clears
  per-loop runtime state (counters, video position), not the persisted
  detections.
- Webcam streams are per-process; multiple simultaneous streams from one
  device are not supported (one process owns the capture device).

## Security

- The `X-Internal-Key` shared secret defaults to
  `dev-internal-key-change-in-production` for development parity. It MUST be
  overridden in any real deployment via `INTERNAL_API_KEY` (backend) and
  `BACKEND_INTERNAL_KEY` (AI service). In production (`NODE_ENV=production`),
  the server refuses to start if insecure defaults are detected.
- The AI service's webcam stats endpoint (`/detect/webcam/stats`) supports
  optional header-based auth via `AI_STATS_REQUIRE_AUTH=true`. Disabled by
  default for development convenience.
- The AI service's CORS origins are configurable via `CORS_ORIGINS` env var.
  When unset, all origins are allowed (development mode).
- Camera credentials (`username`/`password`) are stored in the database in
  plain text; they are used only to reach private RTSP/HTTP sources.

## Data & metrics

- Detection timestamps use server time; cross-region deployments would need
  timezone-aware reporting.
- Per-frame metrics are aggregated in memory (`metricsByKey`); long-running
  processes accumulate counters until a detector restart.
- CSV export streams all matching rows into memory before sending — very
  large ranges should use filters.

## Frontend

- The live camera page uses the AI service's `/detect/webcam` MJPEG stream
  and polls stats; it is a demo-grade viewer, not a low-latency WebRTC
  player.
- Snapshot thumbnails are served from the backend media root; clean up old
  files with external tooling.
