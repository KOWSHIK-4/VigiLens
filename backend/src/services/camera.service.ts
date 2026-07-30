import { prisma } from "@/config/prisma";
import type { CameraStatus, CameraType, Prisma } from "@prisma/client";
import type { CreateCameraInput, UpdateCameraInput } from "@/types";

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
};
