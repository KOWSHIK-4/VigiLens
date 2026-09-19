import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import {
  correlateFleet,
  FLEET_DEFAULT_WINDOW_MS,
  FLEET_MAX_WINDOW_MS,
  type CrossCameraSequence,
  type FleetDetectionInput,
} from "./fleetCorrelation";

function clampWindow(windowMs: number | undefined): number {
  if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) {
    return FLEET_DEFAULT_WINDOW_MS;
  }
  return Math.min(Math.floor(windowMs), FLEET_MAX_WINDOW_MS);
}

/** Bounded: never loads the whole table, only the requested window. */
async function loadWindow(windowMs: number, limit = 10_000): Promise<FleetDetectionInput[]> {
  const from = new Date(Date.now() - windowMs);
  const rows = await prisma.detection.findMany({
    where: { timestamp: { gte: from } },
    select: {
      id: true,
      cameraId: true,
      detectorKey: true,
      className: true,
      label: true,
      confidence: true,
      timestamp: true,
      trackId: true,
      metadata: true,
      camera: { select: { name: true } },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return rows.map((row) => {
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};
    const correlation =
      metadata.correlation && typeof metadata.correlation === "object"
        ? { eventId: (metadata.correlation as { eventId?: string }).eventId }
        : null;
    return {
      id: row.id,
      cameraId: row.cameraId,
      cameraName: row.camera?.name ?? null,
      detectorKey: row.detectorKey,
      className: row.className ?? null,
      label: row.label,
      confidence: row.confidence,
      timestamp: row.timestamp,
      trackId: row.trackId,
      correlation,
    };
  });
}

export const fleetCorrelationService = {
  async analyze(
    windowMs?: number,
    cameraId?: string,
  ): Promise<{ windowMs: number; sequences: CrossCameraSequence[] }> {
    const safeWindow = clampWindow(windowMs);
    try {
      let detections = await loadWindow(safeWindow);
      if (cameraId) {
        detections = detections.filter(
          (d) => d.cameraId === cameraId || d.cameraName === cameraId,
        );
      }
      const sequences = correlateFleet(detections, safeWindow);
      return { windowMs: safeWindow, sequences };
    } catch (err) {
      logger.error("Cross-camera fleet correlation failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  clampWindow,
};