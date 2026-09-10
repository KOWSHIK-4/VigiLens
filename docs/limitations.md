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
- The AI service's webcam stream and stats endpoints (`/detect/webcam`,
  `/detect/webcam/stats`) require `X-Internal-Key` auth in production *and*
  whenever a real (non-default) `BACKEND_INTERNAL_KEY` is configured. Only a
  development deployment still using the bundled default key keeps them open;
  set `AI_STATS_REQUIRE_AUTH=true` to force the check in development too.
- The AI service's CORS origins are configurable via `CORS_ORIGINS` or
  `CORS_ORIGIN` env var. In production, if no origins are configured the
  service defaults to same-origin only (no cross-origin requests).
- Camera credentials (`username`/`password`) are stored in the database in
  plain text; they are used only to reach private RTSP/HTTP sources. They are
  never returned by the API — camera responses are redacted at the service
  layer and a Prisma query extension strips `password` from any Camera-shaped
  row (including nested includes).

## Data & metrics

- Detection and audit timestamps are stored as absolute instants. Analytics
  accept an optional `tz` IANA parameter (e.g. `tz=Asia/Kolkata`) so daily
  buckets, hour-of-day timelines and "today"/period windows align with the
  reporting user's clock; without it, the database server's time zone is used.
- Per-frame metrics are aggregated in memory (`metricsByKey`); long-running
  processes accumulate counters until a detector restart.
- CSV export streams matching rows in bounded, ordered batches with write
  backpressure, so export memory stays flat regardless of result size.
- Detection snapshots and recordings are cleaned by the `npm run prune:media`
  tool (`backend/src/scripts/pruneMedia.ts`). It honours the
  `image_retention_days`, `video_retention_days` and `max_storage_gb` storage
  settings, also purges expired detection rows (cascading to alerts), and only
  ever touches `snapshots/` and `recordings/` beneath the storage root. It is
  a CLI tool: operators must schedule it (e.g. cron) at the
  `cleanup_interval_days` cadence — no in-process scheduler runs it yet.

## Frontend

- The live camera page uses the AI service's `/detect/webcam` MJPEG stream
  and polls stats; it is a demo-grade viewer, not a low-latency WebRTC
  player.
- Snapshot thumbnails are served from the backend media root; the
  `npm run prune:media` tool (and its settings-backed retention/quotas) keeps
  those files bounded.
