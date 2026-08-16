# Adding a New Detector

This guide explains how to add a new detector (for example a "helmet"
detector) across the three layers: AI service, backend catalog, and (optionally)
frontend.

## 1. AI service (`ai/`)

1. Create `ai/app/detectors/<name>.py` with a class extending
   `BaseDetector` (`ai/app/detectors/base.py`). Implement:
   - `name` — returns the model registration name, e.g. `"helmet_detector"`.
   - `detect(image, confidence_threshold=None)` — runs inference and returns
     `List[Detection]`. Use `confidence_threshold` when provided, otherwise
     fall back to the detector default.
   - `draw(image, detections)` — overlay helper.
2. Register the detector in `ai/app/main.py` (the `detector_service`
   registration block) so `/detect/image`, `/detect/video` and
   `/detect/webcam` can select it.
3. If the new model is a YOLO variant, subclass `YoloDetector` and override
   `_detector_name` / class filtering instead of writing a new detector.

## 2. Backend catalog (`backend/src/engine/modelCatalog.ts`)

Add a mapping entry so the engine knows the detector is runnable:

```ts
export const AI_DETECTOR_MODELS: Record<string, string> = {
  person: "person_detector",
  vehicle: "vehicle_detector",
  helmet: "helmet_detector", // new
};
```

Without this entry the detector reports `unconfigured` and the engine
refuses to run it (`501 DETECTOR_UNCONFIGURED`). No fabricated detections.

## 3. Detector definition (optional, for the marketplace)

If the detector should appear in the models/detectors management UI, add a
definition in `backend/src/detectors/` (see existing entries) so
`modelService.syncRegisteredDetectors()` creates its `AIModel` row.

## 4. Tests

- AI: add `ai/tests/test_<name>.py` covering the confidence override and
  validation (see `ai/tests/test_confidence.py` for the pattern).
- Backend: add or extend `backend/tests/engine-*.test.ts` for runnable /
  unconfigured behavior.

## 5. Run the checks

```bash
# AI
cd ai && py -3.14 -m pytest -q

# Backend
cd backend && npm run typecheck && npm run lint && npm run build && npm test
```

## Ship model weights

Model weights are never committed to the repository. Mount them into the AI
container at `MODEL_PATH` (default `/app/models`) and load them at startup.
The detector stays `ARCHITECTURE READY` until weights are present.
