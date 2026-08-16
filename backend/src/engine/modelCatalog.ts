/**
 * Detector Engine v2 — Detector Model Catalog.
 *
 * Single source of truth mapping backend detector keys to the models
 * registered in the AI inference service. Detectors without a catalog
 * entry have no real trained model and must never fabricate detections;
 * they are handled by the `unconfigured` executor path.
 */

/** Backend detector key -> AI service model name. */
export const AI_DETECTOR_MODELS: Record<string, string> = {
  person: "person_detector",
  vehicle: "vehicle_detector",
};

/** The AI model name for a backend detector key, or undefined. */
export function aiDetectorModel(key: string): string | undefined {
  return AI_DETECTOR_MODELS[key];
}

/** True when a real AI model is wired to the detector key. */
export function isDetectorRunnable(key: string): boolean {
  return Boolean(AI_DETECTOR_MODELS[key]);
}
