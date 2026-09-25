import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import {
  computeRiskScore,
  type RiskContext,
  type RiskScore,
} from "./riskScore";

const RISK_WINDOW_MS = 30 * 60 * 1000;
const RISK_MAX_DETECTIONS = 2000;

/**
 * Builds risk context for a detection from genuinely measured rows: detections
 * of the same class in the window, existing correlation metadata already
 * stored on detections, fleet sequences computed from the same window, recent
 * alerts and active incidents. Nothing is fabricated — absent data produces
 * zeroed factor contributions with an explanation saying the factor was not
 * observed.
 */
async function loadRiskContext(detectionId: string, organizationId?: string, teamScopeId?: string): Promise<RiskContext> {
  const base = await prisma.detection.findFirst({
    where: { id: detectionId, ...(organizationId ? { organizationId } : {}), ...(teamScopeId ? { teamId: teamScopeId } : {}) },
    include: { camera: { select: { id: true, name: true } } },
  });
  if (!base) {
    throw new ApiError(404, "Detection not found");
  }

  const from = new Date(base.timestamp.getTime() - RISK_WINDOW_MS);
  const to = new Date(base.timestamp.getTime() + RISK_WINDOW_MS);
  const orgWhere = { ...(organizationId ? { organizationId } : {}), ...(teamScopeId ? { teamId: teamScopeId } : {}) };
  const className = base.className ?? base.label;

  const [sameClass, windowDetections, recentAlerts, activeIncidents] = await Promise.all([
    prisma.detection.findMany({
      where: {
        ...orgWhere,
        id: { not: detectionId },
        OR: [
          { className },
          className === null ? undefined : { label: className },
        ].filter((entry): entry is { className: string } | { label: string } => Boolean(entry)),
        timestamp: { gte: from, lte: to },
      },
      select: { id: true },
      take: RISK_MAX_DETECTIONS,
    }),
    prisma.detection.findMany({
      where: { ...orgWhere, timestamp: { gte: from, lte: to } },
      select: {
        id: true,
        className: true,
        label: true,
        detectorKey: true,
        metadata: true,
        cameraId: true,
        timestamp: true,
      },
      take: RISK_MAX_DETECTIONS,
    }),
    prisma.alert.findMany({
      where: { ...orgWhere, createdAt: { gte: from, lte: to } },
      select: { severity: true },
    }),
    prisma.incident.count({
      where: {
        ...orgWhere,
        status: { not: "resolved" },
        alert: { detection: { OR: [{ className }, { label: className }] } },
      },
    }),
  ]);

  // Correlation-flagged members and cross-camera sequence membership come
  // from the correlation / fleet-correlation layers' own metadata.
  const correlatedEventIds = new Set<string>();
  let crossCameraSequenceCount = 0;
  for (const det of windowDetections) {
    const metadata =
      det.metadata && typeof det.metadata === "object"
        ? (det.metadata as Record<string, unknown>)
        : {};
    const correlation = metadata.correlation as
      | { eventId?: string; correlated?: boolean }
      | undefined;
    if (correlation?.eventId && correlation.correlated) {
      correlatedEventIds.add(correlation.eventId);
    }
  }

  // Cross-camera: count distinct cameras that had a same-class detection in
  // the window (excluding the base one). Conservative — never infers identity.
  const crossCameraCameras = new Set(
    windowDetections
      .filter(
        (det) =>
          (det.className ?? det.label) === className &&
          det.cameraId !== base.cameraId,
      )
      .map((det) => det.cameraId),
  );
  crossCameraSequenceCount = crossCameraCameras.size;

  // Temporal concentration: same-class activity tightly clustered.
  const sameClassTimes = windowDetections
    .filter((det) => (det.className ?? det.label) === className)
    .map((det) => det.timestamp.getTime())
    .sort((a, b) => a - b);
  let temporalConcentration = false;
  if (sameClassTimes.length >= 3) {
    const span = sameClassTimes[sameClassTimes.length - 1]! - sameClassTimes[0]!;
    temporalConcentration =
      span <= Math.max(RISK_WINDOW_MS / 3, 60_000);
  }

  const alertSeverity = recentAlerts.reduce<"" | "info" | "warning" | "critical">(
    (max, alert) =>
      alert.severity === "critical" ||
      (alert.severity === "warning" && max !== "critical") ||
      (alert.severity === "info" && max === "")
        ? alert.severity
        : max,
    "",
  );

  return {
    maxConfidence: base.confidence,
    detectionCount: sameClass.length + 1,
    correlatedEventCount: correlatedEventIds.size,
    crossCameraSequenceCount,
    recentAlertCount: recentAlerts.length,
    activeIncidentCount: activeIncidents,
    alertSeverity,
    detectorKey: base.detectorKey,
    className: base.className ?? base.label,
    temporalConcentration,
  };
}

export const riskScoreService = {
  async forDetection(detectionId: string, organizationId?: string, teamScopeId?: string): Promise<RiskScore> {
    try {
      const context = await loadRiskContext(detectionId, organizationId, teamScopeId);
      return computeRiskScore(context);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      logger.error("Risk scoring failed", {
        detectionId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  computeRiskScore,
};