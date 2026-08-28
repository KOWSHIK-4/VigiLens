import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import {
  getDetectorDefinition,
  getDetectorCategories,
  getDetectorDefinitions,
} from "../detectors";
import { deriveLifecycleStatus, lifecycleManager } from "../engine/lifecycle";
import type { DetectorRuntimeStatus } from "../engine/types";
import { notifyDetectorRestart } from "../engine/engineHooks";
import { ApiError } from "../utils/errors";
import type { AIModel, CameraType, DetectorSettings, Prisma } from "@prisma/client";

export type DetectorStatus = "running" | "stopped" | "error";

const RESTART_DELAY_MS = 1200;

const restartTimers = new Map<string, NodeJS.Timeout>();

interface ModelWithRelations extends AIModel {
  settings: DetectorSettings | null;
  cameraAssignments: Array<{ enabled: boolean; camera: { id: string; name: string } }>;
}

export interface DetectorAssignmentInput {
  cameraId: string;
  enabled: boolean;
}

/** Maps a persisted camera type to the detector "supported input" vocabulary. */
export function cameraInputFor(cameraType: CameraType): string {
  switch (cameraType) {
    case "usb":
      return "webcam";
    case "rtsp":
    case "ip":
    case "video_file":
      return "video";
    default:
      return "video";
  }
}

/** Whether a camera (by type) is compatible with a detector's supported inputs. */
export function detectorSupportsCamera(supportedInput: string[], cameraType: CameraType): boolean {
  return supportedInput.includes(cameraInputFor(cameraType));
}

function clearRestartTimer(id: string) {
  const timer = restartTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    restartTimers.delete(id);
  }
}

export function detectorStatusOf(model: Pick<AIModel, "status" | "enabled">): DetectorStatus {
  if (model.status === "error") return "error";
  if (model.enabled && model.status === "loaded") return "running";
  return "stopped";
}

function detectorInclude() {
  return {
    settings: true,
    cameraAssignments: {
      include: { camera: true },
    },
  } satisfies Prisma.AIModelInclude;
}

interface LifecycleFields {
  status: DetectorRuntimeStatus;
  lastInferenceAt: string | null;
  lastSuccessfulInferenceAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/**
 * Derives the honest engine lifecycle status plus measured engine facts for
 * an installed detector. The legacy 3-state `status` stays available for
 * backwards compatibility; the UI and health surfaces use `runtimeStatus`
 * so a detector is never shown as ready unless it actually ran.
 */
function runtimeLifecycleOf(
  model: Pick<AIModel, "detectorKey" | "enabled" | "status">,
  availability: string | undefined,
): LifecycleFields {
  const key = model.detectorKey;
  // Snapshot measured facts before mirroring the enabled flag — setEnabled
  // resets the failure streak on a disabled→enabled transition, and reading
  // afterwards would hide an in-progress failure streak from the UI.
  const state = lifecycleManager.get(key);
  const aiReachable = state.aiReachable;
  const consecutiveFailures = state.consecutiveFailures;
  const lastSuccessfulInferenceAt = state.lastSuccessfulInferenceAt;
  lifecycleManager.setEnabled(key, model.enabled);
  const status = deriveLifecycleStatus({
    installed: true,
    enabled: model.enabled,
    availability: availability === "available" ? "available" : "unconfigured",
    modelStatus: model.status,
    aiReachable,
    consecutiveFailures,
    lastSuccessfulInferenceAt,
  });
  return {
    status,
    lastInferenceAt: state.lastInferenceAt,
    lastSuccessfulInferenceAt: state.lastSuccessfulInferenceAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
  };
}

function serialize(model: ModelWithRelations) {
  const def = getDetectorDefinition(model.detectorKey);
  const status = detectorStatusOf(model);
  const lifecycle = runtimeLifecycleOf(model, def?.availability);
  return {
    id: model.id,
    name: model.name,
    version: model.version,
    description: model.description,
    detectorKey: model.detectorKey,
    type: def?.type ?? "object_detection",
    supportedInput: def?.supportedInput ?? [],
    category: def?.category ?? "Other",
    icon: def?.icon ?? "brain",
    inferenceTimeMs: def?.inferenceTimeMs ?? 30,
    confidenceThreshold: model.confidenceThreshold,
    enabled: model.enabled,
    status,
    // Honest lifecycle status (registered/configured/enabled/disabled/loading/
    // ready/error/unavailable/unconfigured) — never "ready" without a real run.
    runtimeStatus: lifecycle.status,
    lastInferenceAt: lifecycle.lastInferenceAt,
    lastSuccessfulInferenceAt: lifecycle.lastSuccessfulInferenceAt,
    lastError: lifecycle.lastError,
    lastErrorAt: lifecycle.lastErrorAt,
    gpuSupported: model.gpuSupported,
    modelPath: model.modelPath,
    lastRestartAt: model.lastRestartAt,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    settings: model.settings
      ? {
          alertSeverity: model.settings.alertSeverity,
          detectionIntervalMs: model.settings.detectionIntervalMs,
          alertCooldownMs: model.settings.alertCooldownMs,
          preferredProcessor: model.settings.preferredProcessor,
        }
      : null,
    cameras: model.cameraAssignments.map((a) => ({
      id: a.camera.id,
      name: a.camera.name,
      enabled: a.enabled,
    })),
    cameraCount: model.cameraAssignments.length,
    // Raw model load status ("loaded" | "loading" | "disabled" | "error") —
    // distinct from the serialized `status` which collapses to running/stopped.
    modelStatus: model.status,
  };
}

async function ensureSettings(aiModelId: string): Promise<DetectorSettings> {
  const existing = await prisma.detectorSettings.findUnique({
    where: { aiModelId },
  });
  if (existing) return existing;
  return prisma.detectorSettings.create({
    data: { aiModelId },
  });
}

async function findModelOrThrow(id: string): Promise<ModelWithRelations> {
  const model = await prisma.aIModel.findUnique({
    where: { id },
    include: detectorInclude(),
  });
  if (!model) {
    throw new ApiError(404, "Detector not found");
  }
  const settings = await ensureSettings(id);
  return { ...model, settings };
}

export interface MarketplaceItem {
  key: string;
  name: string;
  version: string;
  description: string;
  category: string;
  icon: string;
  type: string;
  supportedInput: string[];
  defaultConfidenceThreshold: number;
  gpuSupported: boolean;
  modelPath: string;
  inferenceTimeMs: number;
  installed: boolean;
  id: string | null;
  enabled: boolean | null;
  status: DetectorStatus | null;
  runtimeStatus: DetectorRuntimeStatus | null;
  lastInferenceAt: string | null;
  confidenceThreshold: number | null;
  alertSeverity: DetectorSettings["alertSeverity"] | null;
  detectionIntervalMs: number | null;
  alertCooldownMs: number | null;
  preferredProcessor: DetectorSettings["preferredProcessor"] | null;
  cameraCount: number;
}

export const detectorService = {
  detectorStatusOf,

  async getMarketplace(): Promise<MarketplaceItem[]> {
    const definitions = getDetectorDefinitions();
    const installed = await prisma.aIModel.findMany({
      include: detectorInclude(),
    });
    const installedByKey = new Map(installed.map((m) => [m.detectorKey, m]));

    return definitions
      .map((def) => {
        const model = installedByKey.get(def.key);
        const settings = model?.settings;
        const lifecycle = model ? runtimeLifecycleOf(model, def.availability) : null;
        return {
          key: def.key,
          name: def.name,
          version: def.version,
          description: def.description,
          category: def.category,
          icon: def.icon,
          type: def.type,
          supportedInput: def.supportedInput,
          defaultConfidenceThreshold: def.defaultConfidenceThreshold,
          gpuSupported: def.gpuSupported,
          modelPath: def.modelPath,
          inferenceTimeMs: def.inferenceTimeMs,
          installed: Boolean(model),
          id: model?.id ?? null,
          enabled: model?.enabled ?? null,
          status: model ? detectorStatusOf(model) : null,
          runtimeStatus: lifecycle?.status ?? null,
          lastInferenceAt: lifecycle?.lastInferenceAt ?? null,
          confidenceThreshold: model?.confidenceThreshold ?? null,
          alertSeverity: settings?.alertSeverity ?? null,
          detectionIntervalMs: settings?.detectionIntervalMs ?? null,
          alertCooldownMs: settings?.alertCooldownMs ?? null,
          preferredProcessor: settings?.preferredProcessor ?? null,
          cameraCount: model?.cameraAssignments.length ?? 0,
        };
      });
  },

  getCategories() {
    return getDetectorCategories();
  },

  async getAll(params: {
    page: number;
    limit: number;
    search?: string;
    status?: string;
    type?: string;
    enabled?: boolean;
    category?: string;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) {
    const models = await prisma.aIModel.findMany({
      include: detectorInclude(),
    });

    let rows = models.map(serialize);

    if (params.search) {
      const q = params.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.detectorKey.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      );
    }
    if (params.status) {
      if (params.status === "running" || params.status === "stopped" || params.status === "error") {
        rows = rows.filter((r) => r.status === params.status);
      } else {
        rows = rows.filter((r) => r.runtimeStatus === params.status);
      }
    }
    if (params.type) {
      rows = rows.filter((r) => r.type === params.type);
    }
    if (params.enabled !== undefined) {
      rows = rows.filter((r) => r.enabled === params.enabled);
    }
    if (params.category) {
      rows = rows.filter((r) => r.category === params.category);
    }

    const sortBy = params.sortBy || "name";
    const sortOrder = params.sortOrder || "asc";
    const dir = sortOrder === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortBy];
      const bv = (b as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1 * dir;
      if (bv == null) return -1 * dir;
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });

    const total = rows.length;
    const start = (params.page - 1) * params.limit;
    const data = rows.slice(start, start + params.limit);
    return { data, total };
  },

  async getById(id: string) {
    const model = await findModelOrThrow(id);
    return serialize(model);
  },

  async install(detectorKey: string) {
    const def = getDetectorDefinition(detectorKey);
    if (!def) {
      throw new ApiError(400, `Unknown detector key "${detectorKey}"`);
    }

    const existing = await prisma.aIModel.findUnique({
      where: { detectorKey },
    });
    if (existing) {
      throw new ApiError(409, `Detector "${def.name}" is already installed`);
    }

    const model = await prisma.aIModel.create({
      data: {
        name: def.name,
        version: def.version,
        description: def.description,
        detectorKey: def.key,
        confidenceThreshold: def.defaultConfidenceThreshold,
        enabled: true,
        gpuSupported: def.gpuSupported,
        modelPath: def.modelPath,
        status: "disabled",
      },
    });
    await ensureSettings(model.id);

    const withRelations = await prisma.aIModel.findUnique({
      where: { id: model.id },
      include: detectorInclude(),
    });
    if (!withRelations) {
      throw new ApiError(500, "Failed to load installed detector");
    }

    logger.info("Detector installed", { detectorId: model.id, detectorKey: def.key });
    return serialize(withRelations);
  },

  async uninstall(id: string) {
    const model = await findModelOrThrow(id);
    clearRestartTimer(id);
    await prisma.aIModel.delete({ where: { id } });
    logger.info("Detector uninstalled", { detectorId: id, detectorKey: model.detectorKey });
    return { success: true, id, detectorKey: model.detectorKey };
  },

  async setEnabled(id: string, enabled: boolean) {
    const model = await findModelOrThrow(id);

    const data: Prisma.AIModelUpdateInput = { enabled };
    if (!enabled && (model.status === "loaded" || model.status === "loading")) {
      data.status = "disabled";
      clearRestartTimer(id);
    }

    const updated = await prisma.aIModel.update({ where: { id }, data });
    return serialize({ ...updated, settings: model.settings, cameraAssignments: model.cameraAssignments });
  },

  /** Generic detector update: name, description, version and enabled flag. */
  async update(id: string, input: {
    name?: string;
    description?: string;
    version?: string;
    enabled?: boolean;
  }) {
    const model = await findModelOrThrow(id);

    const data: Prisma.AIModelUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.version !== undefined) data.version = input.version;
    if (input.enabled !== undefined) {
      data.enabled = input.enabled;
      if (!input.enabled && (model.status === "loaded" || model.status === "loading")) {
        data.status = "disabled";
        clearRestartTimer(id);
      }
    }

    const updated = await prisma.aIModel.update({ where: { id }, data });
    return serialize({
      ...updated,
      settings: model.settings,
      cameraAssignments: model.cameraAssignments,
    });
  },

  async updateSettings(id: string, input: {
    confidenceThreshold?: number;
    alertSeverity?: DetectorSettings["alertSeverity"];
    detectionIntervalMs?: number;
    alertCooldownMs?: number;
    preferredProcessor?: DetectorSettings["preferredProcessor"];
  }) {
    const model = await findModelOrThrow(id);

    const settings = await prisma.detectorSettings.update({
      where: { aiModelId: id },
      data: {
        alertSeverity: input.alertSeverity,
        detectionIntervalMs: input.detectionIntervalMs,
        alertCooldownMs: input.alertCooldownMs,
        preferredProcessor: input.preferredProcessor,
      },
    });

    const modelData: Prisma.AIModelUpdateInput = {};
    if (input.confidenceThreshold !== undefined) {
      modelData.confidenceThreshold = input.confidenceThreshold;
    }
    const updated = input.confidenceThreshold !== undefined
      ? await prisma.aIModel.update({ where: { id }, data: modelData })
      : model;

    return serialize({
      ...updated,
      settings,
      cameraAssignments: model.cameraAssignments,
    });
  },

  async assignCameras(id: string, input: { cameraIds?: string[]; assignments?: DetectorAssignmentInput[] }) {
    const model = await findModelOrThrow(id);
    const def = getDetectorDefinition(model.detectorKey);

    const rows = input.assignments
      ? input.assignments.map((a) => ({ cameraId: a.cameraId, enabled: a.enabled }))
      : (input.cameraIds ?? []).map((cameraId) => ({ cameraId, enabled: true }));

    const uniqueIds = new Set(rows.map((r) => r.cameraId));
    if (uniqueIds.size !== rows.length) {
      throw new ApiError(400, "Camera ids must be unique");
    }

    const cameras = await prisma.camera.findMany({
      where: { id: { in: rows.map((r) => r.cameraId) } },
      select: { id: true, name: true, cameraType: true },
    });
    if (cameras.length !== rows.length) {
      throw new ApiError(400, "One or more camera ids are invalid");
    }

    if (def) {
      for (const camera of cameras) {
        if (!detectorSupportsCamera(def.supportedInput, camera.cameraType)) {
          throw new ApiError(
            400,
            `Camera "${camera.name}" (${camera.cameraType}) is not supported by detector "${def.name}". ` +
              `Supported inputs: ${def.supportedInput.join(", ")}.`,
          );
        }
      }
    }

    await prisma.$transaction([
      prisma.detectorCamera.deleteMany({ where: { aiModelId: id } }),
      prisma.detectorCamera.createMany({
        data: rows.map((r) => ({ aiModelId: id, cameraId: r.cameraId, enabled: r.enabled })),
      }),
    ]);

    const updated = await prisma.aIModel.findUnique({
      where: { id },
      include: detectorInclude(),
    });
    if (!updated) {
      throw new ApiError(404, "Detector not found");
    }

    logger.info("Detector cameras assigned", { detectorId: id, cameraCount: rows.length });
    return serialize({ ...updated, settings: model.settings });
  },

  async health(id: string) {
    const model = await findModelOrThrow(id);
    const def = getDetectorDefinition(model.detectorKey);
    const status = detectorStatusOf(model);
    // `inferenceTimeMs` is the definition's documented estimate, only used
    // until real engine metrics are measured (see GET /engines/:key/metrics).
    const latencyMs = def?.inferenceTimeMs ?? null;
    const base = model.lastRestartAt ?? model.createdAt;
    const uptime =
      status === "running"
        ? Math.max(0, Math.floor((Date.now() - base.getTime()) / 1000))
        : 0;

    return {
      id: model.id,
      name: model.name,
      detectorKey: model.detectorKey,
      status,
      healthy: status === "running",
      message:
        status === "running"
          ? "Detector is operating normally"
          : status === "error"
            ? "Detector is in an error state"
            : "Detector is stopped",
      latencyMs,
      uptimeSeconds: uptime,
      lastHealthCheck: new Date().toISOString(),
      assignedCameras: model.cameraAssignments.length,
      // No engine run has been measured for this detector yet, so report
      // nothing rather than fabricated values. Real per-detector metrics are
      // exposed through GET /engines/:key/metrics.
      framesProcessed: null,
      throughputFps: null,
    };
  },

  async restart(id: string) {
    const model = await findModelOrThrow(id);

    if (!model.enabled) {
      throw new ApiError(400, "Cannot restart a disabled detector. Enable it first.");
    }
    if (model.status === "loading") {
      throw new ApiError(409, "Detector is already restarting");
    }

    // Scope the reset to this detector so restarting one model does not
    // wipe trackers/metrics of every other detector in the process.
    notifyDetectorRestart(model.detectorKey);
    clearRestartTimer(id);

    const restarting = await prisma.aIModel.update({
      where: { id },
      data: { status: "loading", lastRestartAt: new Date() },
    });

    const timer = setTimeout(async () => {
      restartTimers.delete(id);
      try {
        const current = await prisma.aIModel.findUnique({ where: { id } });
        if (!current || !current.enabled) return;
        await prisma.aIModel.update({
          where: { id },
          data: { status: "loaded" },
        });
        logger.info("Detector restarted", { detectorId: id });
      } catch (error) {
        logger.error("Detector restart failed to finalize", { detectorId: id, error });
        try {
          await prisma.aIModel.update({ where: { id }, data: { status: "error" } });
        } catch (fallbackError) {
          logger.error("Failed to mark detector as error", { detectorId: id, fallbackError });
        }
      }
    }, RESTART_DELAY_MS);
    restartTimers.set(id, timer);

    return serialize({
      ...restarting,
      settings: model.settings,
      cameraAssignments: model.cameraAssignments,
    });
  },

  async byKey(detectorKey: string) {
    const model = await prisma.aIModel.findUnique({
      where: { detectorKey },
      include: detectorInclude(),
    });
    if (!model) return null;
    return serialize({ ...model, settings: model.settings });
  },
};

export const SRC_MARKER = "src-detector-service-live";
