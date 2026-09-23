import { prisma } from "../config/prisma";
import { ApiError } from "../utils/errors";
import { metricsService } from "./metrics.service";
import { publishAlertCreated } from "./realtime.service";
import { webhookService } from "./webhook.service";
import type { AlertQueryInput } from "../types";
import type { AlertSeverity, Prisma } from "@prisma/client";

const alertInclude = {
  detection: { include: { camera: { select: { id: true, name: true, location: true } } } },
  incident: {
    select: { id: true, status: true },
  },
  team: { select: { id: true, name: true } },
} satisfies Prisma.AlertInclude;

interface CreateAlertInput {
  detectionId: string;
  severity: AlertSeverity;
  title: string;
  message: string;
}

function buildAlertWhere(
  params: Pick<AlertQueryInput, "severity" | "isRead" | "search" | "cameraId" | "teamId" | "dateFrom" | "dateTo">,
  organizationId?: string,
): Prisma.AlertWhereInput {
  const where: Prisma.AlertWhereInput = {};
  if (organizationId) where.organizationId = organizationId;

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

  if (params.teamId) {
    where.teamId = params.teamId;
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

export type UnreadSeverityCounts = Record<AlertSeverity, number>;

/**
 * Maps raw `groupBy` rows into a stable { critical, warning, info } shape.
 * Kept pure and exported so the mapping logic is unit-testable without a
 * database.
 */
export function aggregateUnreadSeverityCounts(
  rows: Array<{ severity: AlertSeverity; _count: { severity: number } }>,
): UnreadSeverityCounts {
  const bySeverity: UnreadSeverityCounts = { critical: 0, warning: 0, info: 0 };
  for (const row of rows) {
    bySeverity[row.severity] = row._count.severity;
  }
  return bySeverity;
}

export const alertService = {
  async create(input: CreateAlertInput, organizationId?: string) {
    // Engine/ingestion path has no caller context: the tenant is inherited
    // from the governing detection row.
    if (!organizationId) {
      const detection = await prisma.detection.findUnique({
        where: { id: input.detectionId },
        select: { organizationId: true },
      });
      organizationId = detection?.organizationId;
    }
    if (!organizationId) {
      throw new ApiError(400, "Cannot create alert without a tenant organization");
    }
    const alert = await prisma.alert.create({
      data: {
        detectionId: input.detectionId,
        severity: input.severity,
        title: input.title,
        message: input.message,
        organizationId,
      },
      include: alertInclude,
    });
    publishAlertCreated(alert, organizationId);
    void webhookService.dispatchAlertCreated(alert);
    metricsService.recordEvent("alerts.created");
    return alert;
  },

  async findAll(params: AlertQueryInput, organizationId?: string) {
    const where = buildAlertWhere(params, organizationId);

    const [data, total] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: alertInclude,
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.alert.count({ where }),
    ]);

    return { data, total };
  },

  async *streamCSV(params: AlertQueryInput, pageSize = 500, organizationId?: string) {
    const where = buildAlertWhere(params, organizationId);
    let skip = 0;

    for (;;) {
      const alerts = await prisma.alert.findMany({
        where,
        include: { detection: { include: { camera: { select: { id: true, name: true, location: true } } } } },
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

  async markAsRead(id: string, organizationId?: string) {
    const alert = await prisma.alert.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!alert) throw new ApiError(404, "Alert not found");

    return prisma.alert.update({
      where: { id },
      data: { isRead: true },
      include: alertInclude,
    });
  },

  async acknowledge(id: string, actor: { id: string; name: string }, organizationId?: string) {
    const alert = await prisma.alert.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!alert) throw new ApiError(404, "Alert not found");

    return prisma.alert.update({
      where: { id },
      data: {
        isRead: true,
        acknowledgedAt: new Date(),
        acknowledgedById: actor.id,
        acknowledgedByName: actor.name,
      },
      include: alertInclude,
    });
  },

  async escalate(id: string, actor: { id: string; name: string }, note?: string, organizationId?: string) {
    const alert = await prisma.alert.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!alert) throw new ApiError(404, "Alert not found");

    return prisma.alert.update({
      where: { id },
      data: {
        isRead: true,
        acknowledgedAt: alert.acknowledgedAt ?? new Date(),
        acknowledgedById: alert.acknowledgedById ?? actor.id,
        acknowledgedByName: alert.acknowledgedByName ?? actor.name,
        escalatedAt: new Date(),
        escalatedById: actor.id,
        escalatedByName: actor.name,
        escalationNote: note ?? null,
      },
      include: alertInclude,
    });
  },

  async assignTeam(id: string, teamId: string | null, organizationId?: string) {
    const alert = await prisma.alert.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!alert) throw new ApiError(404, "Alert not found");

    if (teamId) {
      const team = await prisma.team.findFirst({
        where: { id: teamId, ...(organizationId ? { organizationId } : {}) },
        select: { id: true },
      });
      if (!team) throw new ApiError(404, "Team not found");
    }

    if ((alert.teamId ?? null) === teamId) {
      return prisma.alert.findFirst({ where: { id, ...(organizationId ? { organizationId } : {}) }, include: alertInclude });
    }

    const updated = await prisma.alert.update({
      where: { id },
      data: { teamId },
      include: alertInclude,
    });

    publishAlertCreated({
      id: updated.id,
      severity: updated.severity,
      title: updated.title,
      message: updated.message,
      createdAt: updated.createdAt,
      teamId: updated.teamId,
    }, organizationId);

    return updated;
  },

  async markAllAsRead(organizationId?: string) {
    await prisma.alert.updateMany({
      where: { isRead: false, ...(organizationId ? { organizationId } : {}) },
      data: { isRead: true },
    });
  },

  async countUnread(organizationId?: string, teamScopeId?: string) {
    return prisma.alert.count({
      where: {
        isRead: false,
        ...(organizationId ? { organizationId } : {}),
        ...(teamScopeId ? { teamId: teamScopeId } : {}),
      },
    });
  },

  /**
   * Unread alert population broken down by severity, derived from a single
   * grouped query. The dashboard uses this instead of issuing one filtered
   * list request per severity on every polling tick.
   */
  async countUnreadBySeverity(organizationId?: string) {
    const rows = await prisma.alert.groupBy({
      by: ["severity"],
      where: { isRead: false, ...(organizationId ? { organizationId } : {}) },
      _count: { severity: true },
    });
    return aggregateUnreadSeverityCounts(rows);
  },

  async remove(id: string, organizationId?: string) {
    const alert = await prisma.alert.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!alert) throw new ApiError(404, "Alert not found");

    await prisma.alert.delete({ where: { id } });
    return { id };
  },

  async getLatest(limit = 10, organizationId?: string) {
    return prisma.alert.findMany({
      where: organizationId ? { organizationId } : {},
      include: alertInclude,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  },
};
