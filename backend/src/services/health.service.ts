import { promises as fs } from "node:fs";
import path from "node:path";
import { config } from "../config";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { appVersion } from "../config/version";
import { settingsService } from "./settings.service";

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

function databaseNameFromUrl(url: string): string {
  try {
    const withoutScheme = url.replace(/^[a-z]+:\/\//i, "");
    const withoutQuery = withoutScheme.split("?")[0];
    const segments = withoutQuery.split("/");
    return segments[segments.length - 1] || "unknown";
  } catch {
    return "unknown";
  }
}

function postgresVersionFromServer(serverVersion: string): string {
  const match = serverVersion.match(/PostgreSQL (\d+(?:\.\d+)?)/i);
  return match ? `PostgreSQL ${match[1]}` : serverVersion;
}

async function checkDatabase(): Promise<ServiceHealth> {
  const name = "postgres";
  const label = "PostgreSQL";
  const start = Date.now();
  try {
    const rows = await prisma.$queryRaw<Array<{ server_version: string }>>`SELECT version() as server_version`;
    const serverVersion =
      rows.length > 0 ? postgresVersionFromServer(String(rows[0].server_version)) : undefined;
    return {
      name,
      label,
      status: "healthy",
      responseTimeMs: Date.now() - start,
      lastChecked: nowIso(),
      version: serverVersion,
      detail: databaseNameFromUrl(config.database.url),
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

function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

const AI_HEALTH_TIMEOUT_MS = 3000;

async function checkAI(): Promise<ServiceHealth> {
  const name = "ai";
  const label = "AI Service";
  const start = Date.now();
  const url = `${config.ai.serviceUrl}/health`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_HEALTH_TIMEOUT_MS);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return degradedService(
        name,
        label,
        Date.now() - start,
        `AI service returned HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as {
      status?: string;
      service?: string;
      version?: string;
    };
    return {
      name,
      label,
      status: body.status === "ok" ? "healthy" : "degraded",
      responseTimeMs: Date.now() - start,
      lastChecked: nowIso(),
      version: typeof body.version === "string" ? body.version : undefined,
      detail: typeof body.service === "string" ? body.service : undefined,
    };
  } catch (error) {
    logger.warn("AI service health check failed", { error, url });
    return offlineService(
      name,
      label,
      Date.now() - start,
      error instanceof Error ? error.message : "AI service unreachable",
    );
  }
}

function checkRedis(): ServiceHealth {
  return {
    name: "redis",
    label: "Redis / Cache",
    status: "not_configured",
    responseTimeMs: 0,
    lastChecked: nowIso(),
    detail: "Redis cache is not configured",
  };
}

async function getStorageBasePath(): Promise<string> {
  try {
    const value = await settingsService.getValue("storage", "storage_base_path");
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // settings unavailable; fall back to the configured default
  }
  return "/data/vigilens";
}

async function checkStorage(): Promise<ServiceHealth> {
  const name = "storage";
  const label = "Storage";
  const start = Date.now();
  const basePath = await getStorageBasePath();
  try {
    await fs.mkdir(basePath, { recursive: true });
    const probe = path.join(basePath, `.vigilens-health-${process.pid}-${Date.now()}.tmp`);
    await fs.writeFile(probe, "ok");
    await fs.unlink(probe);

    const stats = await fs.statfs(basePath);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);

    return {
      name,
      label,
      status: "healthy",
      responseTimeMs: Date.now() - start,
      lastChecked: nowIso(),
      detail: `${basePath} (${formatBytes(availableBytes)} free of ${formatBytes(totalBytes)})`,
    };
  } catch (error) {
    logger.warn("Storage health check failed", { error, basePath });
    return degradedService(
      name,
      label,
      Date.now() - start,
      `${basePath}: ${error instanceof Error ? error.message : "Storage unavailable"}`,
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

  async getStorageBasePath(): Promise<string> {
    return getStorageBasePath();
  },

  async getReadiness(): Promise<HealthReport> {
    const startedAt = Date.now();
    const services = await Promise.all([
      checkDatabase(),
      checkPrisma(),
      checkAI(),
      checkStorage(),
      checkRedis(),
    ]);
    return {
      status: overallStatus(services),
      services,
      responseTimeMs: Date.now() - startedAt,
      timestamp: nowIso(),
      version: appVersion,
      uptime: Math.round(process.uptime()),
    };
  },

  get aiServiceUrl(): string {
    return config.ai.serviceUrl;
  },
};