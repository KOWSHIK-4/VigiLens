import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import { ApiError } from "@/utils/errors";
import { settingsService } from "@/services/settings.service";
import { aiServiceClient, AiServiceError, type AiServiceClient } from "@/engine/aiClient";
import type { CameraStatus, CameraType, Prisma } from "@prisma/client";
import type { CreateCameraInput, UpdateCameraInput } from "@/types";

const SNAPSHOT_TIMEOUT_MS = 10_000;
const SNAPSHOT_SUBDIR = "snapshots";

function snapshotFilePath(id: string, dir: string): string {
  return path.join(dir, `${id}.jpg`);
}

async function resolveSnapshotDir(): Promise<string> {
  const base = await settingsService.getValue("storage", "storage_base_path");
  const basePath = typeof base === "string" && base ? base : "/data/vigilens";
  return path.join(basePath, SNAPSHOT_SUBDIR);
}

function mapCaptureError(err: unknown): ApiError {
  if (err instanceof AiServiceError) {
    switch (err.reason) {
      case "unreachable":
        return new ApiError(502, "AI capture service is unreachable", {
          code: "AI_SERVICE_UNREACHABLE",
        });
      case "timeout":
        return new ApiError(502, "Timed out capturing a frame from the camera", {
          code: "AI_SERVICE_TIMEOUT",
        });
      case "http":
        return new ApiError(502, `AI service failed to capture the frame: ${err.message}`, {
          code: "AI_CAPTURE_FAILED",
        });
      case "invalid_frame":
        return new ApiError(422, err.message, { code: "AI_CAPTURE_FAILED" });
      default:
        return new ApiError(502, `AI capture failed: ${err.message}`, {
          code: "AI_CAPTURE_FAILED",
        });
    }
  }
  if (err instanceof ApiError) return err;
  return new ApiError(
    502,
    `Failed to capture a frame: ${err instanceof Error ? err.message : String(err)}`,
    { code: "CAMERA_CAPTURE_FAILED" },
  );
}

async function recordCaptureFailure(id: string, message: string, responseTimeMs: number) {
  const now = new Date();
  await Promise.all([
    prisma.camera.update({
      where: { id },
      data: {
        status: "error",
        isHealthy: false,
        lastHealthCheck: now,
      },
    }),
    prisma.cameraHealthLog.create({
      data: {
        cameraId: id,
        status: "error",
        message,
        responseTime: responseTimeMs,
      },
    }),
  ]);
}

interface FindAllParams {
  page: number;
  limit: number;
  search?: string;
  status?: CameraStatus;
  cameraType?: CameraType;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export const cameraService = {
  async findAll(params: FindAllParams) {
    const { page, limit, search, status, cameraType, sortBy, sortOrder } = params;

    const where: Prisma.CameraWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
        { url: { contains: search, mode: "insensitive" } },
      ];
    }

    if (status) where.status = status;
    if (cameraType) where.cameraType = cameraType;

    const orderBy: Prisma.CameraOrderByWithRelationInput = {};
    if (sortBy && ["name", "status", "cameraType", "location", "lastSeen", "createdAt"].includes(sortBy)) {
      orderBy[sortBy as keyof Prisma.CameraOrderByWithRelationInput] = sortOrder || "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [data, total] = await Promise.all([
      prisma.camera.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.camera.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  async findById(id: string) {
    return prisma.camera.findUnique({
      where: { id },
      include: {
        detections: {
          orderBy: { timestamp: "desc" },
          take: 20,
        },
        healthLogs: {
          orderBy: { checkedAt: "desc" },
          take: 10,
        },
      },
    });
  },

  async create(data: CreateCameraInput) {
    return prisma.camera.create({
      data: {
        name: data.name,
        url: data.url,
        cameraType: data.cameraType as CameraType,
        sourceURL: data.sourceURL || null,
        location: data.location || null,
        resolution: data.resolution || null,
        fps: data.fps || null,
        username: data.username || null,
        password: data.password || null,
      },
    });
  },

  async update(id: string, data: UpdateCameraInput) {
    const existing = await prisma.camera.findUnique({ where: { id } });
    if (!existing) return null;

    return prisma.camera.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.url !== undefined && { url: data.url }),
        ...(data.cameraType !== undefined && { cameraType: data.cameraType as CameraType }),
        ...(data.sourceURL !== undefined && { sourceURL: data.sourceURL }),
        ...(data.location !== undefined && { location: data.location }),
        ...(data.resolution !== undefined && { resolution: data.resolution }),
        ...(data.fps !== undefined && { fps: data.fps }),
        ...(data.username !== undefined && { username: data.username }),
        ...(data.password !== undefined && { password: data.password }),
      },
    });
  },

  async remove(id: string) {
    const existing = await prisma.camera.findUnique({ where: { id } });
    if (!existing) return false;

    await prisma.camera.delete({ where: { id } });
    return true;
  },

  async startCamera(id: string) {
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) return null;

    if (camera.status === "online") {
      throw new Error("Camera is already online");
    }

    return prisma.camera.update({
      where: { id },
      data: {
        status: "connecting",
        lastSeen: new Date(),
      },
    });
  },

  async stopCamera(id: string) {
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) return null;

    if (camera.status === "offline") {
      throw new Error("Camera is already offline");
    }

    return prisma.camera.update({
      where: { id },
      data: {
        status: "offline",
      },
    });
  },

  async healthCheck(id: string) {
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) return null;

    const start = Date.now();
    let isHealthy = false;
    let responseTime: number | null = null;
    let message: string | null = null;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(camera.url, { signal: controller.signal, method: "HEAD" });
      clearTimeout(timeout);

      responseTime = Date.now() - start;
      isHealthy = res.ok;
      message = isHealthy ? "Camera responded successfully" : `HTTP ${res.status}`;
    } catch (err) {
      responseTime = Date.now() - start;
      isHealthy = false;
      message = err instanceof Error ? err.message : "Health check failed";
    }

    const status: CameraStatus = isHealthy ? "online" : "error";

    await prisma.cameraHealthLog.create({
      data: {
        cameraId: id,
        status,
        message,
        responseTime,
      },
    });

    return prisma.camera.update({
      where: { id },
      data: {
        status,
        isHealthy,
        lastHealthCheck: new Date(),
        lastSeen: isHealthy ? new Date() : undefined,
      },
    });
  },

  async getHealthLogs(cameraId: string, limit = 50) {
    return prisma.cameraHealthLog.findMany({
      where: { cameraId },
      orderBy: { checkedAt: "desc" },
      take: limit,
    });
  },

  async captureSnapshot(
    id: string,
    client: AiServiceClient = aiServiceClient,
    snapshotDir?: string,
  ) {
    const camera = await prisma.camera.findUnique({ where: { id } });
    if (!camera) {
      throw new ApiError(404, "Camera not found");
    }

    const startedAt = Date.now();
    try {
      const frame = await client.captureFrame(
        camera.url,
        camera.cameraType,
        0,
        SNAPSHOT_TIMEOUT_MS,
      );
      const responseTimeMs = Date.now() - startedAt;

      const dir = snapshotDir ?? (await resolveSnapshotDir());
      await mkdir(dir, { recursive: true });
      await writeFile(snapshotFilePath(id, dir), frame);

      const capturedAt = new Date();
      const snapshotUrl = `/api/cameras/${id}/thumbnail`;
      const updated = await prisma.camera.update({
        where: { id },
        data: {
          thumbnail: snapshotUrl,
          status: "online",
          isHealthy: true,
          lastHealthCheck: capturedAt,
          lastSnapshotAt: capturedAt,
          lastSeen: capturedAt,
        },
      });
      await prisma.cameraHealthLog.create({
        data: {
          cameraId: id,
          status: "online",
          message: "Frame captured successfully",
          responseTime: responseTimeMs,
        },
      });

      return { camera: updated, snapshotUrl, responseTimeMs, capturedAt };
    } catch (err) {
      const responseTimeMs = Date.now() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Camera snapshot capture failed", { id, message });
      await recordCaptureFailure(id, message, responseTimeMs);
      throw mapCaptureError(err);
    }
  },

  async getSnapshot(id: string, snapshotDir?: string) {
    const dir = snapshotDir ?? (await resolveSnapshotDir());
    try {
      return await readFile(snapshotFilePath(id, dir));
    } catch {
      return null;
    }
  },
};
