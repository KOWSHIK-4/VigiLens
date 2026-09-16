import { prisma } from "../config/prisma";
import type { AuditLogAction, AuditLogStatus, Prisma } from "@prisma/client";
import type { AuditLogQueryInput } from "../types";
import { auditRowMatchesHash, computeAuditHash } from "../utils/auditChain";

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

const STATS_CACHE_TTL_MS = 5_000;
let cachedStats: { data: unknown; expiresAt: number } | null = null;
let cachedCharts: { data: unknown; expiresAt: number } | null = null;

export const auditLogService = {
  async create(input: CreateAuditLogInput) {
    const row = await prisma.auditLog.create({
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
    return prisma.auditLog.update({
      where: { id: row.id },
      data: { hash: computeAuditHash(row) },
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

  /**
   * Streaming CSV export. Walks the full filter scope in bounded pages so the
   * controller can write incrementally instead of buffering every row.
   */
  async *streamCSV(params: FindAllParams, pageSize = 500) {
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

    let skip = 0;
    for (;;) {
      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: pageSize,
        skip,
      });
      if (logs.length === 0) return;
      for (const log of logs) {
        yield [
          log.id,
          log.timestamp.toISOString(),
          log.username,
          log.email,
          log.action,
          log.module,
          log.description,
          log.ipAddress,
          log.status,
        ];
      }
      skip += logs.length;
    }
  },

  async getStats() {
    if (cachedStats && cachedStats.expiresAt > Date.now()) {
      return cachedStats.data;
    }
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

    const data = {
      totalLogs,
      todayLogs,
      failedLogs,
      activeUsers: activeUsers.length,
    };
    cachedStats = { data, expiresAt: Date.now() + STATS_CACHE_TTL_MS };
    return data;
  },

  async getChartData() {
    if (cachedCharts && cachedCharts.expiresAt > Date.now()) {
      return cachedCharts.data;
    }
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

    const data = {
      actionsPerDay: actionsPerDay as { date: string; count: number }[],
      moduleUsage: moduleUsage as { module: string; count: number }[],
      statusDistribution: statusDistribution as { status: string; count: number }[],
      topUsers: topUsers as { username: string; email: string; count: number }[],
    };
    cachedCharts = { data, expiresAt: Date.now() + STATS_CACHE_TTL_MS };
    return data;
  },

  /**
   * Recomputes the tamper-evidence hash of every audit row and reports any
   * row whose stored hash no longer matches. Rows without a hash (created
   * before this feature was deployed) are reported as legacy rather than
   * tampered: they predate stamping and cannot be validated retroactively.
   */
  async verifyIntegrity(bound = 100_000) {
    const rows = await prisma.auditLog.findMany({
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: bound,
    });

    const tamperedRows: string[] = [];
    let legacyRows = 0;
    let checkedRows = 0;
    for (const row of rows) {
      if (!row.hash) {
        legacyRows += 1;
        continue;
      }
      checkedRows += 1;
      if (!auditRowMatchesHash(row, row.hash)) {
        tamperedRows.push(row.id);
        if (tamperedRows.length >= 100) break;
      }
    }

    const scanned = tamperedRows.length >= 100 ? bound : rows.length;
    return {
      verified: tamperedRows.length === 0,
      scannedRows: scanned,
      checkedRows,
      legacyRows,
      tamperedRows,
    };
  },

  /**
   * One-time backfill: stamps every audit row that is missing a hash (i.e.
   * rows written before the feature shipped). Idempotent, so it can run on
   * every startup with negligible cost once the table is stamped.
   */
  async backfillHashes(batchSize = 500) {
    let stamped = 0;
    while (true) {
      const rows = await prisma.auditLog.findMany({
        where: { hash: null },
        orderBy: [{ timestamp: "asc" }, { id: "asc" }],
        take: batchSize,
      });
      if (rows.length === 0) break;
      await prisma.$transaction(
        rows.map((row) =>
          prisma.auditLog.update({
            where: { id: row.id },
            data: { hash: computeAuditHash(row) },
          }),
        ),
      );
      stamped += rows.length;
    }
    return stamped;
  },
};
