import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import {
  summarizeCameraReliability,
  type CameraReliability,
  type CameraFleetReliabilityRow,
} from "./cameraReliability";

export const FLEET_HEALTH_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FLEET_HEALTH_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface CameraFleetHealth {
  cameraId: string;
  name: string;
  location: string | null;
  status: string;
  reliability: CameraReliability;
}

export interface CameraFleetHealthSummary {
  /** Aggregate availability across all cameras that have checks in-window
   * (weighted by check count), null only when no camera has any check. */
  fleetAvailabilityPct: number | null;
  /** Share of cameras whose last in-window check was online. */
  onlineSharePct: number;
  fleetStatus: "healthy" | "degraded" | "at_risk" | "unknown";
  totalCameras: number;
  camerasWithChecks: number;
  totalHealthyChecks: number;
  totalChecks: number;
  offlineCameras: number;
  degradedCameras: number;
  reason: string;
  windowMinutes: number;
  cameras: CameraFleetHealth[];
}

export function clampWindow(windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Invalid fleet health window");
  }
  return Math.min(windowMs, FLEET_HEALTH_MAX_WINDOW_MS);
}

/** Orders health summaries worst-first: lowest availability first, cameras
 * with no in-window checks last. */
export function summarizeFleetHealth(
  cameras: CameraFleetHealth[],
  windowMs: number,
): CameraFleetHealthSummary {
  const sorted = [...cameras].sort((a, b) => {
    const keyA =
      a.reliability.availabilityPct === null
        ? Number.POSITIVE_INFINITY
        : a.reliability.availabilityPct;
    const keyB =
      b.reliability.availabilityPct === null
        ? Number.POSITIVE_INFINITY
        : b.reliability.availabilityPct;
    return keyA - keyB;
  });

  let totalHealthyChecks = 0;
  let totalChecks = 0;
  let offlineCameras = 0;
  let degradedCameras = 0;
  let camerasWithChecks = 0;

  for (const camera of sorted) {
    const rel = camera.reliability;
    totalHealthyChecks += rel.healthyChecks;
    totalChecks += rel.totalChecks;
    if (rel.totalChecks > 0) camerasWithChecks += 1;
    const availability = rel.availabilityPct;
    if (availability !== null && availability < 100) degradedCameras += 1;
    if (rel.lastStatus === "offline") offlineCameras += 1;
  }

  const fleetAvailabilityPct =
    totalChecks === 0 ? null : Math.round((totalHealthyChecks / totalChecks) * 1000) / 10;

  const onlineShare =
    camerasWithChecks === 0
      ? 0
      : Math.round(
          (sorted.filter((c) => c.reliability.lastStatus === "online").length /
            camerasWithChecks) *
            1000,
        ) / 10;

  let fleetStatus: CameraFleetHealthSummary["fleetStatus"];
  if (camerasWithChecks === 0) {
    fleetStatus = "unknown";
  } else if (degradedCameras === 0 && offlineCameras === 0) {
    fleetStatus = "healthy";
  } else if (offlineCameras === 0 && degradedCameras <= 1) {
    fleetStatus = "degraded";
  } else {
    fleetStatus = "at_risk";
  }

  const reason =
    camerasWithChecks === 0
      ? "No camera has a health check in the reporting window."
      : `${degradedCameras} camera(s) with less than 100% availability, ${offlineCameras} offline.`;

  return {
    fleetAvailabilityPct,
    onlineSharePct: onlineShare,
    fleetStatus,
    totalCameras: sorted.length,
    camerasWithChecks,
    totalHealthyChecks,
    totalChecks,
    offlineCameras,
    degradedCameras,
    reason,
    windowMinutes: Math.round(windowMs / 60_000),
    cameras: sorted,
  };
}

async function loadFleetHealth(
  windowMs: number,
  organizationId?: string,
  teamScopeId?: string,
): Promise<CameraFleetHealth[]> {
  const from = new Date(Date.now() - windowMs);

  const [cameras, healthLogs] = await Promise.all([
    prisma.camera.findMany({
      select: { id: true, name: true, location: true, status: true },
      where: { ...(organizationId ? { organizationId } : {}), ...(teamScopeId ? { teamId: teamScopeId } : {}) },
      orderBy: { name: "asc" },
    }),
    prisma.cameraHealthLog.findMany({
      where: {
        checkedAt: { gte: from },
        ...(organizationId ? { camera: { organizationId } } : {}),
        ...(teamScopeId ? { camera: { teamId: teamScopeId } } : {}),
      },
      select: {
        cameraId: true,
        status: true,
        responseTime: true,
        checkedAt: true,
      },
      orderBy: { checkedAt: "asc" },
    }),
  ]);

  const byCamera = new Map<string, CameraFleetReliabilityRow[]>();
  for (const log of healthLogs) {
    const list = byCamera.get(log.cameraId) ?? [];
    list.push({
      cameraId: log.cameraId,
      status: log.status,
      responseTime: log.responseTime,
      checkedAt: log.checkedAt,
    });
    byCamera.set(log.cameraId, list);
  }

  return cameras.map((camera) => {
    const rows = byCamera.get(camera.id) ?? [];
    return {
      cameraId: camera.id,
      name: camera.name,
      location: camera.location,
      status: camera.status,
      reliability: summarizeCameraReliability(rows, windowMs),
    };
  });
}

export const cameraFleetHealthService = {
  async summarize(windowMs?: number, organizationId?: string, teamScopeId?: string): Promise<CameraFleetHealthSummary> {
    const bounded = clampWindow(windowMs ?? FLEET_HEALTH_DEFAULT_WINDOW_MS);
    try {
      const fleet = await loadFleetHealth(bounded, organizationId, teamScopeId);
      return summarizeFleetHealth(fleet, bounded);
    } catch (err) {
      logger.error("Camera fleet health failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  summarizeFleetHealth,
  clampWindow,
};