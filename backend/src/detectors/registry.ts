export interface DetectorDefinition {
  key: string;
  name: string;
  version: string;
  description: string;
  defaultConfidenceThreshold: number;
  gpuSupported: boolean;
  modelPath: string;
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
