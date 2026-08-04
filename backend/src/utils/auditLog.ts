import type { AuditLogAction, AuditLogStatus, Prisma } from "@prisma/client";
import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";

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
}

export async function logAudit(params: LogAuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
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
      },
    });
  } catch (error) {
    logger.error("Failed to write audit log", { error, action: params.action, module: params.module });
  }
}
