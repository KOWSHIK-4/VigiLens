import type { DetectorType, DetectorAvailability, ProcessingMode } from "../engine/types";

export interface DetectorDefinition {
  key: string;
  name: string;
  version: string;
  description: string;
  category: string;
  icon: string;
  /** Model task type, e.g. object_detection. */
  type: DetectorType;
  /** Whether a real trained model is available for this detector. */
  availability: DetectorAvailability;
  /** Inputs the detector can consume. */
  supportedInput: string[];
  defaultConfidenceThreshold: number;
  gpuSupported: boolean;
  modelPath: string;
  /** Estimated latency used only when no real metrics exist yet. */
  inferenceTimeMs: number;
  /** COCO class names this detector filters when backed by YOLO. */
  classFilter?: string[];
  /** Default operational configuration. */
  defaultConfiguration?: {
    detectionIntervalMs: number;
    maxDetectionsPerFrame: number;
    alertSeverity: "info" | "warning" | "critical";
    alertCooldownMs: number;
    inputResolution: string;
    processingMode: ProcessingMode;
  };
  autoInstall?: boolean;
}

const detectors = new Map<string, DetectorDefinition>();

export function registerDetector(def: DetectorDefinition): void {
  detectors.set(def.key, def);
}

export function getDetectorDefinitions(): DetectorDefinition[] {
  return Array.from(detectors.values());
}

export function getDetectorDefinition(key: string): DetectorDefinition | undefined {
  return detectors.get(key);
}

export function hasDetector(key: string): boolean {
  return detectors.has(key);
}

export function getDetectorCategories(): string[] {
  const categories = new Set<string>();
  for (const def of detectors.values()) {
    if (def.category) categories.add(def.category);
  }
  return Array.from(categories).sort();
}

export function getAvailableDetectorKeys(): string[] {
  return Array.from(detectors.values())
    .filter((def) => def.availability === "available")
    .map((def) => def.key);
}
