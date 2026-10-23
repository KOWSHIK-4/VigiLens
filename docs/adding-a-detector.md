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
cd ai && python -m pytest -q

# Backend
cd backend && npm run typecheck && npm run lint && npm run build && npm test
```

## Ship model weights

The default model (`yolo11n.pt`) is committed to the repository at
`ai/yolo11n.pt` and copied into the Docker image automatically. For custom
detectors, place the weights file where the AI service can load it (the
detector's `model_name` path) or mount it into the container. The detector
stays `ARCHITECTURE READY` until valid weights are present.


## Pre-merge checklist

Before registering a detector, verify all of the following:

- Its identifier is stable, unique, and matches the backend registry entry.
- Configuration rejects invalid thresholds instead of silently accepting them.
- Missing model weights produce an explicit unavailable/error state; they must not be reported as a successful inference.
- Tests cover both a valid configuration and at least one invalid or unavailable configuration.
- The detector is exercised through the same service/API path used by the application, not only by calling the model class directly.
- Any new weights or sample assets are intentional repository artifacts; never commit credentials or generated runtime output.

## Confidence calibration notes

Confidence thresholds should be chosen from representative validation clips, not from a single successful demo. Record the model/version, test-set composition, threshold, false-positive examples, and missed detections when tuning. Re-run the same clips after changing weights or preprocessing so comparisons remain meaningful. A threshold that improves one camera angle may reduce recall in another, so document known lighting, distance, and occlusion limits.

## Dataset review before evaluation

Before relying on a validation result, record where the clips came from, which supported classes they cover, and whether the set includes difficult conditions such as low light, partial occlusion, and distant subjects. Keep training and validation examples separate, remove duplicate or near-duplicate frames where practical, and avoid including private footage without authorization. Document the limits of the sample so a small test set is not presented as proof of general accuracy.

## Periodic detector drift review

Re-check detector behavior when camera placement, lighting, scene layout, or model weights change. Compare a representative sample against the previous baseline, note changes in false positives and missed detections, and record the model version and evaluation date. Investigate meaningful changes before raising thresholds or replacing weights; a change in scene conditions can look like model drift without being a model defect.

## Detector release acceptance criteria

Before promoting a detector or changing its weights, record the model identifier, input size, confidence threshold, and evaluation dataset version. Review representative true positives, false positives, and missed events, including difficult lighting and occlusion cases. Confirm the service starts with the intended model and that a failed model load produces a visible health/error state instead of silently reporting empty detections. Keep the previous known-good artifact available for rollback.

## Detector privacy review

Before evaluating a new detector, confirm the sample footage is authorized for the intended use and access is limited to people who need it. Prefer representative, minimized samples over collecting extra footage. Document whether images or derived metadata are retained, where they are stored, and when they should be deleted. Avoid putting identifiable frames into issue reports or logs unless there is a clear approved need.

## Detector configuration reproducibility

For each evaluation or release, record the model artifact/version, preprocessing settings, input dimensions, confidence threshold, and relevant runtime dependencies. Keep configuration examples free of secrets and avoid relying on undocumented local defaults. When comparing two runs, change one major variable at a time and note the dataset and environment used so the result can be reproduced. Treat an undocumented configuration as an uncertainty, not as a validated default.
