import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import {
  analyzeIntelligence,
  summarizeIntelligenceContext,
  type IntelligenceReport,
} from "./intelligence.service";

const INTEL_DEFAULT_WINDOW_MS = 30 * 60 * 1000;
const INTEL_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
const INTEL_MAX_DETECTIONS = 2000;
const INTEL_MAX_ALERTS = 500;
const INTEL_MAX_INCIDENTS = 200;

function clampWindow(windowMs: number | undefined): number {
  if (typeof windowMs !== "number" || !Number.isFinite(windowMs) || windowMs <= 0) {
    return INTEL_DEFAULT_WINDOW_MS;
  }
  return Math.min(Math.floor(windowMs), INTEL_MAX_WINDOW_MS);
}

/**
 * Loads the real event data for the given window and runs the pure
 * intelligence engine over it. Every number in the report is derived from
 * rows that actually exist; alerts are loaded with their ack/escalation
 * flags so escalation patterns are measurable rather than assumed.
 */
async function loadEventData(windowMs: number) {
  const from = new Date(Date.now() - windowMs);
  const [detections, alerts, incidents] = await Promise.all([
    prisma.detection.findMany({
      where: { timestamp: { gte: from } },
      select: {
        id: true,
        label: true,
        confidence: true,
        status: true,
        detectorKey: true,
        className: true,
        cameraId: true,
        timestamp: true,
        metadata: true,
        camera: { select: { name: true } },
      },
      orderBy: { timestamp: "desc" },
      take: INTEL_MAX_DETECTIONS,
    }),
    prisma.alert.findMany({
      where: { createdAt: { gte: from } },
      select: {
        id: true,
        severity: true,
        title: true,
        message: true,
        createdAt: true,
        acknowledgedAt: true,
        escalatedAt: true,
        detection: { select: { cameraId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: INTEL_MAX_ALERTS,
    }),
    prisma.incident.findMany({
      where: { openedAt: { gte: from } },
      select: {
        id: true,
        status: true,
        priority: true,
        title: true,
        openedAt: true,
        resolvedAt: true,
      },
      orderBy: { openedAt: "desc" },
      take: INTEL_MAX_INCIDENTS,
    }),
  ]);

  return {
    detections: detections.map((det) => {
      const metadata =
        det.metadata && typeof det.metadata === "object"
          ? (det.metadata as Record<string, unknown>)
          : {};
      const correlation =
        metadata.correlation && typeof metadata.correlation === "object"
          ? (metadata.correlation as { eventId?: string; count?: number })
          : undefined;
      return {
        id: det.id,
        cameraId: det.cameraId,
        cameraName: det.camera?.name,
        detectorKey: det.detectorKey,
        className: det.className,
        label: det.label,
        confidence: det.confidence,
        timestamp: det.timestamp,
        status: det.status,
        correlation,
      };
    }),
    alerts: alerts.map((alert) => ({
      id: alert.id,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      cameraId: alert.detection?.cameraId ?? null,
      createdAt: alert.createdAt,
      acknowledgedAt: alert.acknowledgedAt,
      escalatedAt: alert.escalatedAt,
    })),
    incidents: incidents.map((incident) => ({
      id: incident.id,
      status: incident.status,
      priority: incident.priority,
      title: incident.title,
      openedAt: incident.openedAt,
      resolvedAt: incident.resolvedAt,
    })),
  };
}

export const intelligenceService = {
  async analyze(windowMs?: number): Promise<IntelligenceReport> {
    const safeWindow = clampWindow(windowMs);
    try {
      const data = await loadEventData(safeWindow);
      return analyzeIntelligence({ ...data, windowMs: safeWindow });
    } catch (err) {
      logger.error("Security intelligence analysis failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  async context(windowMs?: number) {
    const safeWindow = clampWindow(windowMs);
    const data = await loadEventData(safeWindow);
    const report = analyzeIntelligence({ ...data, windowMs: safeWindow });
    return {
      windowMs: safeWindow,
      context: summarizeIntelligenceContext({ ...data, windowMs: safeWindow }),
      report,
    };
  },

  clampWindow,
};