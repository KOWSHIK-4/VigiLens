import { config } from "@/config";
import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import { appVersion } from "@/config/version";

export type ServiceStatus = "healthy" | "degraded" | "offline" | "not_configured";

export type OverallStatus = "healthy" | "degraded" | "unhealthy";

export interface ServiceHealth {
  name: string;
  label: string;
  status: ServiceStatus;
  responseTimeMs: number;
  lastChecked: string;
  version?: string;
  detail?: string;
}

export interface HealthReport {
  status: OverallStatus;
  services: ServiceHealth[];
  responseTimeMs: number;
  timestamp: string;
  version: string;
  uptime: number;
}

export interface LivenessReport {
  status: "ok";
  service: "vigilens-api";
  version: string;
  uptime: number;
  timestamp: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function offlineService(
  name: string,
  label: string,
  responseTimeMs: number,
  detail: string,
): ServiceHealth {
  return {
    name,
    label,
    status: "offline",
    responseTimeMs,
    lastChecked: nowIso(),
    detail,
  };
}

function degradedService(
  name: string,
  label: string,
  responseTimeMs: number,
  detail: string,
): ServiceHealth {
  return {
    name,
    label,
    status: "degraded",
    responseTimeMs,
    lastChecked: nowIso(),
    detail,
  };
}

async function checkDatabase(): Promise<ServiceHealth> {
  const name = "postgres";
  const label = "PostgreSQL";
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1 as ok`;
    return {
      name,
      label,
      status: "healthy",
      responseTimeMs: Date.now() - start,
      lastChecked: nowIso(),
    };
  } catch (error) {
    logger.error("Database health check failed", { error });
    return offlineService(
      name,
      label,
      Date.now() - start,
      error instanceof Error ? error.message : "Database unreachable",
    );
  }
}

async function checkPrisma(): Promise<ServiceHealth> {
  const name = "prisma";
  const label = "Prisma ORM";
  const start = Date.now();
  try {
    await prisma.$connect();
    return {
      name,
      label,
      status: "healthy",
      responseTimeMs: Date.now() - start,
      lastChecked: nowIso(),
    };
  } catch (error) {
    logger.error("Prisma connection health check failed", { error });
    return offlineService(
      name,
      label,
      Date.now() - start,
      error instanceof Error ? error.message : "Prisma connection failed",
    );
  }
}

function overallStatus(services: ServiceHealth[]): OverallStatus {
  if (services.some((service) => service.status === "offline")) {
    return "unhealthy";
  }
  if (
    services.some(
      (service) =>
        service.status === "degraded" || service.status === "not_configured",
    )
  ) {
    return "degraded";
  }
  return "healthy";
}

export const healthService = {
  liveness(): LivenessReport {
    return {
      status: "ok",
      service: "vigilens-api",
      version: appVersion,
      uptime: Math.round(process.uptime()),
      timestamp: nowIso(),
    };
  },

  async getReadiness(): Promise<HealthReport> {
    const startedAt = Date.now();
    const services = await Promise.all([checkDatabase(), checkPrisma()]);
    return {
      status: overallStatus(services),
      services,
      responseTimeMs: Date.now() - startedAt,
      timestamp: nowIso(),
      version: appVersion,
      uptime: Math.round(process.uptime()),
    };
  },
};
