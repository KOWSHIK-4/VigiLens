import { prisma } from "../config/prisma";
import { ApiError } from "../utils/errors";
import type { AlertQueryInput } from "../types";
import type { AlertSeverity, Prisma } from "@prisma/client";

interface CreateAlertInput {
  detectionId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
}

function buildAlertWhere(params: Pick<AlertQueryInput, "severity" | "isRead" | "search" | "cameraId" | "dateFrom" | "dateTo">): Prisma.AlertWhereInput {
  const where: Prisma.AlertWhereInput = {};

  if (params.severity) {
    where.severity = params.severity;
  }

  if (params.isRead !== undefined) {
    where.isRead = params.isRead === "true";
  }

  if (params.search) {
    where.OR = [
      { title: { contains: params.search, mode: "insensitive" } },
      { message: { contains: params.search, mode: "insensitive" } },
    ];
  }

  if (params.cameraId) {
    where.detection = { cameraId: params.cameraId };
  }

  if (params.dateFrom || params.dateTo) {
    const createdAtFilter: Prisma.DateTimeFilter = {};
    if (params.dateFrom) {
      createdAtFilter.gte = new Date(params.dateFrom);
    }
    if (params.dateTo) {
      const end = new Date(params.dateTo);
      end.setHours(23, 59, 59, 999);
      createdAtFilter.lte = end;
    }
    where.createdAt = createdAtFilter;
  }

  return where;
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

  async findAll(params: AlertQueryInput) {
    const where = buildAlertWhere(params);

    const [data, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: { detection: { include: { camera: true } } },
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.alert.count({ where }),
    ]);

    return { data, total };
  },

  async *streamCSV(params: AlertQueryInput, pageSize = 500) {
    const where = buildAlertWhere(params);
    let skip = 0;

    for (;;) {
      const alerts = await prisma.alert.findMany({
        where,
        include: { detection: { include: { camera: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: pageSize,
        skip,
      });
      if (alerts.length === 0) return;
      for (const a of alerts) {
        yield [
          a.id,
          a.severity,
          a.title,
          a.message,
          a.detection?.camera?.name ?? a.detection?.cameraId ?? "",
          a.detection?.camera?.location ?? "",
          a.createdAt.toISOString(),
          a.isRead ? "Read" : "Unread",
        ];
      }
      skip += alerts.length;
    }
  },

  async markAsRead(id: string) {
    const alert = await prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new ApiError(404, "Alert not found");

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
    if (!alert) throw new ApiError(404, "Alert not found");

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
