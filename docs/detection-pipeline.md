# Real-Time Detection Pipeline

This document describes how VigiLens turns a camera frame into persisted
detections and alerts — the "Detector Engine v2" pipeline.

## Architecture overview

```
Camera source (RTSP / IP / USB / video file)
        │
        ▼
  Frame capture ────────► AI inference service (FastAPI + YOLO)
        │                         │
        ▼                         ▼
  Preprocess ──► Inference ──► Post-process (NMS + confidence filter)
        │                         │
        ▼                         ▼
        └────────────► Tracking (persistent IoU tracker)
                              │
                              ▼
                        Normalize (boxes → 0..1)
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
        Persist (Detection)          Alerts (per-detector cooldown)
```

The pipeline lives in `backend/src/engine/` and runs in the Node backend.
Inference itself happens in the separate Python AI service (`ai/`), which
exposes `/detect/image`, `/detect/video`, `/detect/webcam` and `/capture`.

## Pipeline stages

Stages are composed with `PipelineBuilder` (`backend/src/engine/pipeline.ts`,
implementation in `pipelineImpl.ts`) and executed in order:

| # | Stage | File | Responsibility |
|---|-------|------|----------------|
| 1 | `frameCapture` | `capture.ts` | Fills a frame from a camera source when the caller provided a source instead of bytes (`process-live`). No-op when the frame already has image bytes. |
| 2 | `preprocess` | `engineService.ts` | Pass-through — decoding/resizing happens in the AI service. |
| 3 | `inference` | `engineService.ts` | Calls the AI service `/detect/image` with the detector's model name and confidence threshold. Never fabricates detections. |
| 4 | `postprocess` | `postprocess.ts` | Confidence filtering + non-maximum suppression (NMS). |
| 5 | `tracking` | `tracking.ts` | Assigns stable track ids per `(detector, camera)` across frames. |
| 6 | `normalize` | `normalize.ts` | Converts boxes to canonical `{x, y, width, height}` (0..1). |
| 7 | `persist` | `engineService.ts` | Stores detections via `detectionService`. |
| 8 | `alerts` | `alerts.ts` | Raises alerts with per-detector cooldown (shared registry). |

Each stage's real measured time is recorded in `PipelineMetrics`.

## Detector model catalog

`backend/src/engine/modelCatalog.ts` is the single source of truth mapping
backend detector keys to AI service model names:

- `person` → `person_detector`
- `vehicle` → `vehicle_detector`

A detector key with no catalog entry has **no trained model** and is reported
as `unconfigured`. The engine refuses to run it rather than fabricating
detections.

## How a frame flows

### 1. Upload an image (`POST /api/engines/:key/process`)

The caller uploads an image. The controller resolves a real camera, then the
engine runs the pipeline with the raw image bytes. Empty bytes are rejected.

### 2. Capture from a camera (`POST /api/engines/:key/process-live`)

The caller supplies `camera_id` (and optionally `video_pos_seconds` for video
files). No image is uploaded — the engine's frame capture stage asks the AI
service `/capture` for a fresh frame from the camera source, then runs the
pipeline. The response includes measured end-to-end latency.

### 3. Continuous monitoring (scheduler)

`monitor.ts` runs a scheduler that, for every enabled detector with an
enabled camera assignment and a real model, captures a frame via `/capture`
and pushes it through the engine at `detectionIntervalMs`. Per-loop state
(frames, detections, errors, video position) is exposed via the monitor API.

## Confidence filtering

- Detector-level threshold is stored on the model row
  (`AIModel.confidenceThreshold`, 0–100) and forwarded to the AI service as a
  `confidence` query parameter (0–1). It never uses a hardcoded value.
- The AI service validates `confidence` (`ge=0.01`, `le=1.0`) and passes it to
  the detector; each detector falls back to its own default when omitted.
- Post-processing applies the same threshold locally plus NMS.

## Tracking

Trackers are **persistent per detector key** and live in the engine service
(`trackersByKey`), so track ids remain stable across frames. A tracker reset
happens on detector restart (via `engineHooks.ts`) and when a webcam stream
reconnects. IoU matching is in `tracking.ts`.

## Alerts and cooldown

- Engine-persisted detections use `CooldownAlertStage`, which raises at most
  one alert per `(detector, camera, class)` within `alertCooldownMs`
  (default 30 s, configurable per detector).
- Machine-to-machine ingestion (`POST /api/detections/internal`, used by the
  AI webcam stream) applies the **same cooldown registry** in
  `detectionService`, so a continuous stream cannot flood the alert queue.
- `skip_alert: true` on the internal endpoint opts out of alert creation.

## Honest metrics

Every number exposed by the engine is measured at runtime:

- `inferenceTimeMs`, stage timings and `throughputFps` come from real runs.
- Model test (`POST /models/:id/test`) performs a real inference probe and
  reports measured latency; when the AI backend is unreachable it states so
  and reports `inferenceTimeMs: null` instead of an invented value.
