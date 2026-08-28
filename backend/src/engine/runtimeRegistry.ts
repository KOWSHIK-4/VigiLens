/**
 * Detector Engine v2 — Runtime Detector Registry.
 *
 * Combines the static DetectorDefinitions with the live status reported
 * by the backend (enabled/disabled, installed, threshold, camera
 * assignments) into `DetectorDescriptor`s that the pipeline consumes.
 */

import { getDetectorDefinition, getDetectorDefinitions } from "../detectors/registry";
import { detectorService } from "../services/detector.service";
import { logger } from "../config/logger";
import { aiServiceClient } from "./aiClient";
import { deriveLifecycleStatus, lifecycleManager } from "./lifecycle";
import type {
  DetectorAvailability,
  DetectorConfiguration,
  DetectorDescriptor,
  DetectorRuntimeStatus,
  ProcessingMode,
} from "./types";
import { detectorConfigurationSchema } from "./configuration";
import { UnconfiguredExecutor, type DetectorExecutor } from "./detectorExecutor";

const DEFAULT_CONFIG: Omit<DetectorConfiguration, "confidenceThreshold"> = {
  detectionIntervalMs: 2000,
  maxDetectionsPerFrame: 20,
  alertSeverity: "info",
  alertCooldownMs: 30000,
  cameraIds: [],
  inputResolution: "640x640",
  processingMode: "auto",
};

function runtimeStatusFor(
  enabled: boolean,
  installed: boolean,
  availability: DetectorAvailability,
  modelStatus: string | null,
  key: string,
): DetectorRuntimeStatus {
  // Snapshot the measured facts BEFORE mirroring the DB enabled flag:
  // setEnabled resets the failure streak on a disabled→enabled transition,
  // and reading state afterwards would report a stale zero streak instead
  // of the in-progress failures that should surface as `error`.
  const state = lifecycleManager.get(key);
  const aiReachable = state.aiReachable;
  const consecutiveFailures = state.consecutiveFailures;
  const lastSuccessfulInferenceAt = state.lastSuccessfulInferenceAt;
  lifecycleManager.setEnabled(key, enabled);
  return deriveLifecycleStatus({
    installed,
    enabled,
    availability,
    modelStatus,
    aiReachable,
    consecutiveFailures,
    lastSuccessfulInferenceAt,
  });
}

/**
 * Probes AI backend reachability for detectors that are loaded, enabled and
 * available. Results are cached per key for a short TTL, so listing engines
 * never hammers the AI service. When the AI service is down the descriptor
 * transitions to `unavailable` instead of silently reporting ready.
 */

function availabilityFor(installed: boolean, definitionAvailable: DetectorAvailability): DetectorAvailability {
  // A definition is only really available when a model is present; an
  // installed-but-unmodelled detector is still `unconfigured`.
  return installed && definitionAvailable === "available" ? "available" : "unconfigured";
}

function toConfiguration(
  definitionAvailable: DetectorAvailability,
  defaults: Partial<DetectorConfiguration> | undefined,
  db: {
    confidenceThreshold: number;
    enabled: boolean;
    installed: boolean;
    settings?: {
      alertSeverity?: DetectorConfiguration["alertSeverity"];
      detectionIntervalMs?: number;
      alertCooldownMs?: number;
      processingMode?: ProcessingMode;
      inputResolution?: string;
    } | null;
    cameraAssignments?: string[];
  },
): DetectorConfiguration {
  return {
    ...DEFAULT_CONFIG,
    confidenceThreshold: db.confidenceThreshold,
    alertSeverity: db.settings?.alertSeverity ?? defaults?.alertSeverity ?? DEFAULT_CONFIG.alertSeverity,
    detectionIntervalMs:
      db.settings?.detectionIntervalMs ?? defaults?.detectionIntervalMs ?? DEFAULT_CONFIG.detectionIntervalMs,
    maxDetectionsPerFrame:
      defaults?.maxDetectionsPerFrame ?? DEFAULT_CONFIG.maxDetectionsPerFrame,
    alertCooldownMs:
      db.settings?.alertCooldownMs ?? defaults?.alertCooldownMs ?? DEFAULT_CONFIG.alertCooldownMs,
    cameraIds: db.cameraAssignments ?? [],
    inputResolution: db.settings?.inputResolution ?? defaults?.inputResolution ?? DEFAULT_CONFIG.inputResolution,
    processingMode: db.settings?.processingMode ?? defaults?.processingMode ?? DEFAULT_CONFIG.processingMode,
  };
}

class RuntimeDetectorRegistry {
  private readonly executors = new Map<string, DetectorExecutor>();

  async describeAll(): Promise<DetectorDescriptor[]> {
    const { data: models } = await detectorService.getAll({
      page: 1,
      limit: 100,
      sortBy: "name",
      sortOrder: "asc",
    });
    const descriptors: DetectorDescriptor[] = [];

    // Probe AI reachability in parallel so a slow/unreachable backend does
    // not serialise the registry listing.
    const probes: Promise<void>[] = [];
    for (const def of getDetectorDefinitions()) {
      const model = models.find((m) => m.detectorKey === def.key);
      const installed = Boolean(model);
      const enabled = installed && Boolean(model?.enabled);
      const rawStatus = installed ? (model as { modelStatus?: string | null }).modelStatus ?? null : null;
      if (
        installed &&
        enabled &&
        def.availability === "available" &&
        rawStatus === "loaded" &&
        lifecycleManager.isProbeDue(def.key)
      ) {
        probes.push(
          aiServiceClient.isReachable().then((reachable) => {
            lifecycleManager.recordReachabilityProbe(def.key, reachable);
            if (!reachable) {
              logger.warn("AI inference service unreachable for detector", { key: def.key });
            }
          }),
        );
      }
    }
    await Promise.all(probes);

    for (const def of getDetectorDefinitions()) {
      const model = models.find((m) => m.detectorKey === def.key);
      const installed = Boolean(model);
      const enabled = installed && Boolean(model?.enabled);
      const rawStatus = installed ? (model as { modelStatus?: string | null }).modelStatus ?? null : null;

      const configuration = toConfiguration(
        def.availability,
        def.defaultConfiguration,
        {
          confidenceThreshold: model?.confidenceThreshold ?? def.defaultConfidenceThreshold,
          enabled,
          installed,
          settings: model?.settings
            ? {
                alertSeverity: model.settings.alertSeverity,
                detectionIntervalMs: model.settings.detectionIntervalMs,
                alertCooldownMs: model.settings.alertCooldownMs,
                processingMode: model.settings.preferredProcessor,
              }
            : null,
          cameraAssignments: model?.cameras?.map((c) => c.id),
        },
      );

      // Re-validate so malformed persisted settings never leak through.
      const validated = detectorConfigurationSchema.parse(configuration);

      descriptors.push({
        id: model?.id ?? `uninstalled:${def.key}`,
        key: def.key,
        name: def.name,
        type: def.type,
        version: def.version,
        status: runtimeStatusFor(enabled, installed, def.availability, rawStatus, def.key),
        enabled,
        availability: availabilityFor(installed, def.availability),
        confidenceThreshold: model?.confidenceThreshold ?? def.defaultConfidenceThreshold,
        supportedInput: def.supportedInput,
        configuration: validated,
        modelVersion: model?.version ?? null,
      });
    }

    return descriptors;
  }

  async describeByKey(key: string): Promise<DetectorDescriptor | undefined> {
    const descriptors = await this.describeAll();
    return descriptors.find((d) => d.key === key);
  }

  /** Register (or refresh) the executor for a detector key. */
  registerExecutor(executor: DetectorExecutor): void {
    const existing = this.executors.get(executor.key);
    if (existing && existing !== executor) {
      // Replace rather than duplicate — the engine owns one executor per key.
      logger.debug("Replacing executor for detector", { key: executor.key });
    }
    this.executors.set(executor.key, executor);
  }

  getExecutor(key: string): DetectorExecutor {
    const executor = this.executors.get(key);
    if (executor) return executor;

    const def = getDetectorDefinition(key);
    if (!def) {
      throw new Error(`Unknown detector key "${key}"`);
    }
    return new UnconfiguredExecutor(key);
  }

  async shutdownAll(): Promise<void> {
    for (const executor of this.executors.values()) {
      try {
        await executor.shutdown();
      } catch (err) {
        logger.error("Failed to shut down detector executor", { key: executor.key, err });
      }
    }
    this.executors.clear();
  }
}

export const runtimeRegistry = new RuntimeDetectorRegistry();
