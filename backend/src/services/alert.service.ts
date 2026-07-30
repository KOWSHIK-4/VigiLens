import { prisma } from "@/config/prisma";
import type { AlertSeverity } from "@prisma/client";

interface CreateAlertInput {
  detectionId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
}

interface FindAllParams {
  page: number;
  limit: number;
  severity?: string;
  isRead?: string;
  search?: string;
}

export const alertService = {
  async create(input: CreateAlertInput) {
    return prisma.alert.create({
      data: {
        detectionId: input.detectionId,
        severity: input.severity,
        title: input.title,
        message: input.message,
      },
      include: { detection: { include: { camera: true } } },
    });
  },

  async findAll(params: FindAllParams) {
    const where: Record<string, unknown> = {};

    if (params.severity) {
      where.severity = params.severity;
    }

    if (params.isRead !== undefined && params.isRead !== "") {
      where.isRead = params.isRead === "true";
    }

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: "insensitive" } },
        { message: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.alert.findMany({
        where: where as any,
        include: { detection: { include: { camera: true } } },
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.alert.count({ where: where as any }),
    ]);

    return { data, total };
  },

  async markAsRead(id: string) {
    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new Error("Alert not found");

    return prisma.alert.update({
      where: { id },
      data: { isRead: true },
      include: { detection: { include: { camera: true } } },
    });
  },

  async markAllAsRead() {
    await prisma.alert.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
  },

  async countUnread() {
    return prisma.alert.count({ where: { isRead: false } });
  },

  async remove(id: string) {
    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new Error("Alert not found");

    await prisma.alert.delete({ where: { id } });
    return { id };
  },

  async getLatest(limit = 10) {
    return prisma.alert.findMany({
      include: { detection: { include: { camera: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};
