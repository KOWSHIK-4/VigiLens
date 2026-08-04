import { prisma } from "@/config/prisma";
import type { AuditLogAction, AuditLogStatus, Prisma } from "@prisma/client";
import type { AuditLogQueryInput } from "@/types";

interface CreateAuditLogInput {
  userId?: string;
  username?: string;
  email?: string;
  action: AuditLogAction;
  module: string;
  description: string;
  ipAddress?: string;
  userAgent?: string;
  status?: AuditLogStatus;
  metadata?: Record<string, unknown>;
}

interface FindAllParams extends AuditLogQueryInput {
  page: number;
  limit: number;
}

export const auditLogService = {
  async create(input: CreateAuditLogInput) {
    return prisma.auditLog.create({
      data: {
        userId: input.userId || null,
        username: input.username || "",
        email: input.email || "",
        action: input.action,
        module: input.module,
        description: input.description,
        ipAddress: input.ipAddress || "",
        userAgent: input.userAgent || "",
        status: input.status || "success",
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  },

  async findAll(params: FindAllParams) {
    const { page, limit, search, userId, action, module, status, dateFrom, dateTo, sortBy, sortOrder } = params;

    const where: Prisma.AuditLogWhereInput = {};

    if (search) {
      where.OR = [
        { username: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { module: { contains: search, mode: "insensitive" } },
      ];
    }

    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (module) where.module = { contains: module, mode: "insensitive" };
    if (status) where.status = status;

    if (dateFrom || dateTo) {
      const timestampFilter: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        timestampFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        timestampFilter.lte = end;
      }
      where.timestamp = timestampFilter;
    }

    const orderBy: Prisma.AuditLogOrderByWithRelationInput = {};
    const validSortFields = ["timestamp", "action", "module", "status", "username", "email"];
    if (sortBy && validSortFields.includes(sortBy)) {
      (orderBy as Record<string, string>)[sortBy] = sortOrder || "desc";
    } else {
      orderBy.timestamp = "desc";
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  },

  async findById(id: string) {
    return prisma.auditLog.findUnique({ where: { id } });
  },

  async exportCSV(params: FindAllParams) {
    const { search, userId, action, module, status, dateFrom, dateTo } = params;

    const where: Prisma.AuditLogWhereInput = {};

    if (search) {
      where.OR = [
        { username: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { module: { contains: search, mode: "insensitive" } },
      ];
    }

    if (userId) where.userId = userId;
    if (action) where.action = action;
    if (module) where.module = { contains: module, mode: "insensitive" };
    if (status) where.status = status;

    if (dateFrom || dateTo) {
      const timestampFilter: Prisma.DateTimeFilter = {};
      if (dateFrom) {
        timestampFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        timestampFilter.lte = end;
      }
      where.timestamp = timestampFilter;
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: "desc" },
    });

    const headers = ["ID", "Timestamp", "User", "Email", "Action", "Module", "Description", "IP Address", "Status"];
    const rows = logs.map((log) => [
      log.id,
      log.timestamp.toISOString(),
      log.username,
      log.email,
      log.action,
      log.module,
      log.description,
      log.ipAddress,
      log.status,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    return csvContent;
  },

  async getStats() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [totalLogs, todayLogs, failedLogs, activeUsers] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.count({ where: { timestamp: { gte: startOfDay } } }),
      prisma.auditLog.count({ where: { status: "failed" } }),
      prisma.auditLog.findMany({
        where: {
          timestamp: { gte: startOfDay },
          userId: { not: null },
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

    return {
      totalLogs,
      todayLogs,
      failedLogs,
      activeUsers: activeUsers.length,
    };
  },

  async getChartData() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [actionsPerDay, moduleUsage, statusDistribution, topUsers] = await Promise.all([
      prisma.$queryRaw`
        SELECT DATE(timestamp) as date, COUNT(*)::int as count
        FROM audit_logs
        WHERE timestamp >= ${thirtyDaysAgo}
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT module, COUNT(*)::int as count
        FROM audit_logs
        WHERE timestamp >= ${thirtyDaysAgo}
        GROUP BY module
        ORDER BY count DESC
        LIMIT 10
      `,
      prisma.$queryRaw`
        SELECT status, COUNT(*)::int as count
        FROM audit_logs
        WHERE timestamp >= ${thirtyDaysAgo}
        GROUP BY status
      `,
      prisma.$queryRaw`
        SELECT username, email, COUNT(*)::int as count
        FROM audit_logs
        WHERE timestamp >= ${thirtyDaysAgo} AND user_id IS NOT NULL AND username != ''
        GROUP BY username, email
        ORDER BY count DESC
        LIMIT 10
      `,
    ]);

    return {
      actionsPerDay: actionsPerDay as { date: string; count: number }[],
      moduleUsage: moduleUsage as { module: string; count: number }[],
      statusDistribution: statusDistribution as { status: string; count: number }[],
      topUsers: topUsers as { username: string; email: string; count: number }[],
    };
  },
};
