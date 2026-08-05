export interface DetectorDefinition {
  key: string;
  name: string;
  version: string;
  description: string;
  category: string;
  icon: string;
  defaultConfidenceThreshold: number;
  gpuSupported: boolean;
  modelPath: string;
  inferenceTimeMs: number;
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
