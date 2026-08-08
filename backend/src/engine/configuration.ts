import { z } from "zod";
import type { DetectorConfiguration, ProcessingMode } from "./types";

export const processingModeSchema = z.enum(["auto", "gpu", "cpu"]);

export const detectorConfigurationSchema = z.object({
  confidenceThreshold: z.number().int().min(0).max(100),
  detectionIntervalMs: z.number().int().min(100).max(600000),
  maxDetectionsPerFrame: z.number().int().min(1).max(100),
  alertSeverity: z.enum(["info", "warning", "critical"]),
  alertCooldownMs: z.number().int().min(0).max(3600000),
  cameraIds: z.array(z.string().min(1).max(100)).min(0).max(100),
  inputResolution: z.string().regex(/^\d{2,4}x\d{2,4}$/, "Resolution must look like 640x640"),
  processingMode: processingModeSchema,
});

export type DetectorConfigurationInput = z.infer<typeof detectorConfigurationSchema>;

/**
 * Validate and normalise a detector configuration. Unknown keys are
 * stripped so persisted configuration always matches the schema.
 */
export function validateDetectorConfiguration(input: unknown): DetectorConfiguration {
  return detectorConfigurationSchema.parse(input);
}

/** Whether a cameraId is assigned to the configuration. */
export function hasCamera(cfg: DetectorConfiguration, cameraId: string): boolean {
  return cfg.cameraIds.includes(cameraId);
}

/** Toggle the assignment of a camera without mutating the original. */
export function withCamera(cfg: DetectorConfiguration, cameraId: string, assign: boolean): DetectorConfiguration {
  const cameraIds = assign
    ? cfg.cameraIds.includes(cameraId)
      ? cfg.cameraIds
      : [...cfg.cameraIds, cameraId]
    : cfg.cameraIds.filter((id) => id !== cameraId);
  return { ...cfg, cameraIds };
}

export function isProcessingMode(value: unknown): value is ProcessingMode {
  return value === "auto" || value === "gpu" || value === "cpu";
}
