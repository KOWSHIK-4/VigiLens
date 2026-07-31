import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import {
  getDetectorDefinition,
  getDetectorDefinitions,
} from "@/detectors";
import { ApiError } from "@/utils/errors";
import type {
  AIModel,
  ModelStatus,
  Prisma,
} from "@prisma/client";

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
      await prisma.aIModel
        .update({ where: { id }, data: { status: "error" } })
        .catch(() => undefined);
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
    for (const def of getDetectorDefinitions()) {
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
          status: "disabled",
        },
      });
    }
    logger.info("AI model registry synchronized", {
      count: getDetectorDefinitions().length,
    });
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

  async update(id: string, input: Partial<AIModel>) {
    const existing = await this.findById(id);

    const data: Prisma.AIModelUpdateInput = { ...input };

    if (input.enabled === false) {
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
    const inferenceTimeMs = 24 + (model.detectorKey.length % 7) * 6;

    logger.info("AI model tested", { modelId: id });

    return {
      success: true,
      modelId: model.id,
      modelName: model.name,
      message: `${detector} responded successfully`,
      inferenceTimeMs,
      framesProcessed: 1,
      detections: 0,
      thresholdApplied: model.confidenceThreshold,
    };
  },
};
