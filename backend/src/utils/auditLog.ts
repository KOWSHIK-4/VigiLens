import type { AuditLogAction, AuditLogStatus, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { computeAuditHash } from "./auditChain";

interface LogAuditParams {
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
  organizationId?: string;
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  try {
    // The tenant scope falls back to the actor's organization so unauthenticated
    // events (failed logins by email, registrations) still land under the right
    // organization. Row-level audit writes (see auditLog.service.create) can
    // supply an explicit scope when no actor exists.
    let organizationId = params.organizationId;
    if (!organizationId && params.userId) {
      const owner = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { organizationId: true },
      });
      organizationId = owner?.organizationId ?? undefined;
    }
    if (!organizationId && params.email) {
      const owner = await prisma.user.findFirst({
        where: { email: params.email, deletedAt: null },
        select: { organizationId: true },
      });
      organizationId = owner?.organizationId ?? undefined;
    }
    const row = await prisma.auditLog.create({
      data: {
        userId: params.userId || null,
        username: params.username || "",
        email: params.email || "",
        action: params.action,
        module: params.module,
        description: params.description,
        ipAddress: params.ipAddress || "",
        userAgent: params.userAgent || "",
        status: params.status || "success",
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
        organizationId,
      },
    });
    await prisma.auditLog.update({
      where: { id: row.id },
      data: { hash: computeAuditHash(row) },
    });
  } catch (error) {
    logger.error("Failed to write audit log", { error, action: params.action, module: params.module });
  }
}
