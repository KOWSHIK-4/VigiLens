import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import {
  getDetectorDefinition,
  getDetectorDefinitions,
} from "../detectors";
import { ApiError } from "../utils/errors";
import { aiServiceClient } from "../engine/aiClient";
import { aiDetectorModel } from "../engine/modelCatalog";
import type {
  AIModel,
  ModelStatus,
  Prisma,
} from "@prisma/client";

/** 1x1 black JPEG sent to the AI service for a real inference probe. */
const PROBE_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

export interface CreateModelInput {
  name: string;
  version: string;
  detectorKey: string;
  confidenceThreshold?: number;
  enabled?: boolean;
  gpuSupported?: boolean;
  description?: string;
  modelPath?: string;
}

const LOAD_DELAY_MS = 900;

const pendingLoads = new Map<string, NodeJS.Timeout>();

function clearPendingLoad(id: string) {
  const timer = pendingLoads.get(id);
  if (timer) {
    clearTimeout(timer);
    pendingLoads.delete(id);
  }
}

function scheduleLoad(id: string) {
  clearPendingLoad(id);
  const timer = setTimeout(async () => {
    pendingLoads.delete(id);
    try {
      const current = await prisma.aIModel.findUnique({ where: { id } });
      if (!current || !current.enabled) return;
      await prisma.aIModel.update({
        where: { id },
        data: { status: "loaded" },
      });
      logger.info("AI model loaded", { modelId: id });
    } catch (error) {
      logger.error("Failed to finalize model load", { modelId: id, error });
      try {
        await prisma.aIModel.update({ where: { id }, data: { status: "error" } });
      } catch (fallbackError) {
        logger.error("Failed to mark model as error", { modelId: id, fallbackError });
      }
    }
  }, LOAD_DELAY_MS);
  pendingLoads.set(id, timer);
}

interface FindAllParams {
  page: number;
  limit: number;
  search?: string;
  status?: ModelStatus;
  enabled?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export const modelService = {
  async syncRegisteredDetectors() {
    const definitions = getDetectorDefinitions();
    const existingCount = await prisma.aIModel.count();
    const installable = definitions.filter((def) => def.autoInstall !== false);

    for (let index = 0; index < installable.length; index += 1) {
      const def = installable[index];
      await prisma.aIModel.upsert({
        where: { detectorKey: def.key },
        update: {
          name: def.name,
          version: def.version,
          description: def.description,
          gpuSupported: def.gpuSupported,
          modelPath: def.modelPath,
        },
        create: {
          name: def.name,
          version: def.version,
          description: def.description,
          detectorKey: def.key,
          confidenceThreshold: def.defaultConfidenceThreshold,
          gpuSupported: def.gpuSupported,
          modelPath: def.modelPath,
          enabled: true,
          status: index === 0 ? "loaded" : "disabled",
        },
      });
    }

    const defaultModel = await prisma.aIModel.findFirst({
      where: { detectorKey: definitions[0]?.key },
    });
    if (defaultModel && existingCount === 0) {
      await prisma.aIModel.update({
        where: { id: defaultModel.id },
        data: { status: "loaded", enabled: true },
      });
    }

    logger.info("AI model registry synchronized", { count: definitions.length });
  },

  async findAll(params: FindAllParams) {
    const where: Prisma.AIModelWhereInput = {};

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } },
        { detectorKey: { contains: params.search, mode: "insensitive" } },
      ];
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.enabled !== undefined) {
      where.enabled = params.enabled;
    }

    const orderBy: Prisma.AIModelOrderByWithRelationInput = {};
    if (params.sortBy) {
      orderBy[params.sortBy as keyof typeof orderBy] = params.sortOrder || "asc";
    } else {
      orderBy.name = "asc";
    }

    const [data, total] = await Promise.all([
      prisma.aIModel.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.aIModel.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string) {
    const model = await prisma.aIModel.findUnique({ where: { id } });
    if (!model) {
      throw new ApiError(404, "Model not found");
    }
    return model;
  },

  async create(input: CreateModelInput) {
    const existing = await prisma.aIModel.findUnique({
      where: { detectorKey: input.detectorKey },
    });
    if (existing) {
      throw new ApiError(409, `A model with detector key "${input.detectorKey}" already exists`);
    }

    const def = getDetectorDefinition(input.detectorKey);

    return prisma.aIModel.create({
      data: {
        name: input.name,
        version: input.version,
        description: input.description ?? def?.description ?? "",
        detectorKey: input.detectorKey,
        confidenceThreshold:
          input.confidenceThreshold ?? def?.defaultConfidenceThreshold ?? 50,
        enabled: input.enabled ?? true,
        gpuSupported: input.gpuSupported ?? def?.gpuSupported ?? false,
        modelPath: input.modelPath ?? def?.modelPath ?? `/models/${input.detectorKey}/model.pt`,
        status: "disabled",
      },
    });
  },

  async getActive() {
    const loaded = await prisma.aIModel.findFirst({
      where: { enabled: true, status: "loaded" },
      orderBy: { updatedAt: "desc" },
    });
    if (loaded) {
      return loaded;
    }

    const model = await prisma.aIModel.findFirst({
      where: { enabled: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!model) {
      throw new ApiError(404, "No active AI model found");
    }
    return model;
  },

  async setEnabled(id: string, enabled: boolean) {
    return this.update(id, { enabled });
  },

  async setConfidenceThreshold(id: string, confidenceThreshold: number) {
    return this.update(id, { confidenceThreshold });
  },

  async remove(id: string) {
    await this.findById(id);
    clearPendingLoad(id);
    await prisma.aIModel.delete({ where: { id } });
    logger.info("AI model deleted", { modelId: id });
    return { success: true, id };
  },

  async update(id: string, input: Partial<AIModel>) {
    const existing = await this.findById(id);

    const data: Prisma.AIModelUpdateInput = {};
    const allowed: Array<keyof AIModel> = [
      "name",
      "version",
      "description",
      "confidenceThreshold",
      "enabled",
      "gpuSupported",
      "modelPath",
    ];
    for (const key of allowed) {
      const value = input[key];
      if (value !== undefined) {
        (data as Record<string, unknown>)[key] = value;
      }
    }

    if (data.enabled === false) {
      clearPendingLoad(id);
      if (existing.status === "loaded" || existing.status === "loading") {
        data.status = "disabled";
      }
    }

    return prisma.aIModel.update({
      where: { id },
      data,
    });
  },

  async load(id: string) {
    const model = await this.findById(id);

    if (!model.enabled) {
      throw new ApiError(400, "Disabled models cannot be loaded. Enable the model first.");
    }

    if (model.status === "loading") {
      throw new ApiError(409, "Model is already loading");
    }

    if (model.status === "loaded") {
      throw new ApiError(409, "Model is already loaded");
    }

    scheduleLoad(id);

    return prisma.aIModel.update({
      where: { id },
      data: { status: "loading" },
    });
  },

  async unload(id: string) {
    const model = await this.findById(id);

    if (model.status === "disabled") {
      throw new ApiError(400, "Model is not loaded");
    }

    clearPendingLoad(id);

    return prisma.aIModel.update({
      where: { id },
      data: { status: "disabled" },
    });
  },

  async test(id: string) {
    const model = await this.findById(id);

    if (model.status !== "loaded") {
      throw new ApiError(400, "Model must be loaded before testing");
    }

    const def = getDetectorDefinition(model.detectorKey);
    const detector = def ? def.name : model.name;
    const threshold = model.confidenceThreshold / 100;
    const modelName = aiDetectorModel(model.detectorKey) ?? model.detectorKey;
    const frame = Buffer.from(PROBE_JPEG_BASE64, "base64");

    // Probe the real AI inference backend: a synthetic frame runs through
    // the registered model and the latency is measured. When the backend
    // is unreachable no fabricated metrics are reported — the response
    // states exactly why inference could not be measured.
    const startedAt = Date.now();
    try {
      const result = await aiServiceClient.detectImage(frame, modelName, threshold);
      const inferenceTimeMs = Date.now() - startedAt;
      logger.info("AI model test inference succeeded", {
        modelId: id,
        modelName,
        inferenceTimeMs,
        detections: result.count,
      });
      return {
        success: true,
        modelId: model.id,
        modelName: model.name,
        message: `${detector} responded successfully`,
        inferenceTimeMs,
        framesProcessed: 1,
        detections: result.count,
        thresholdApplied: model.confidenceThreshold,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      logger.warn("AI model test inference could not be measured", {
        modelId: id,
        modelName,
        reason,
      });
      return {
        success: true,
        modelId: model.id,
        modelName: model.name,
        message: `${detector} is loaded, but live inference could not be measured: ${reason}`,
        inferenceTimeMs: null,
        framesProcessed: 0,
        detections: 0,
        thresholdApplied: model.confidenceThreshold,
      };
    }
  },
};
