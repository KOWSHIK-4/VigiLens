import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import { Prisma, type AlertSeverity, type DetectionStatus } from "@prisma/client";
import { logAudit } from "../utils/auditLog";
import { computeAuditHash } from "../utils/auditChain";
import { sharedAlertCooldownRegistry } from "../engine/alerts";
import { metricsService } from "./metrics.service";
import { publishAlertCreated } from "./realtime.service";
import { webhookService } from "./webhook.service";
import {
  correlationService,
  correlationMessageSuffix,
  type EventCorrelationSummary,
} from "./correlation";
import { detectorCooldownCache } from "../utils/detectorCooldownCache";

/** Nested camera rows only need display fields on read paths. */
const cameraView = { select: { id: true, name: true, location: true } };

/** Shared dedup registry for machine-to-machine ingestion alerts. */
const alertCooldownRegistry = sharedAlertCooldownRegistry;
const DEFAULT_ALERT_COOLDOWN_MS = 30_000;

interface CreateDetectionInput {
  cameraId: string;
  label: string;
  confidence: number;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
  /** Detector Engine v2 fields (all optional, backward compatible). */
  detectorId?: string;
  detectorKey?: string;
  modelVersion?: string;
  trackId?: string;
  className?: string;
  boundingBox?: Record<string, number>;
  snapshotUrl?: string;
  processingTimeMs?: number;
  /** Explicit status override; when omitted it is derived from confidence. */
  status?: DetectionStatus;
  /** When true, no alert is created — the engine's alert stage handles it. */
  skipAlert?: boolean;
  /**
   * When true, at most one alert per (detector, camera, label) is created
   * within the detector's configured alert cooldown. Used by the internal
   * machine-to-machine ingestion so continuous streams cannot flood alerts.
   */
  applyAlertCooldown?: boolean;
}

/**
 * Derives a detection status from its confidence so the severity ladder
 * (info -> warning -> critical) is actually populated. Higher confidence
 * means the detector is more certain an event occurred, so it maps to a
 * more urgent status.
 */
export function deriveDetectionStatus(confidence: number): DetectionStatus {
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.6) return "warning";
  return "info";
}

function getAlertSeverity(status: string): AlertSeverity {
  switch (status) {
    case "critical":
      return "critical";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

/** Alert cooldown for a detector key from its settings, or the default. */
async function resolveAlertCooldownMs(detectorKey?: string): Promise<number> {
  return detectorCooldownCache.resolve(detectorKey, DEFAULT_ALERT_COOLDOWN_MS);
}

function getAlertTitle(label: string, status: string): string {  const prefix =
    status === "critical"
      ? "Critical"
      : status === "warning"
        ? "Warning"
        : "Info";
  return `${prefix} Detection: ${label}`;
}

function getAlertMessage(
  label: string,
  confidence: number,
  cameraName?: string,
): string {
  const location = cameraName ? ` at ${cameraName}` : "";
  return `${label} detected${location} with ${(confidence * 100).toFixed(1)}% confidence.`;
}

interface FindAllParams {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  cameraId?: string;
  dateFrom?: string;
  dateTo?: string;
  confidenceMin?: number;
  confidenceMax?: number;
  sortBy?: string;
  sortOrder?: string;
  /** Server-enforced team scope (own team for actors without teams.read). */
  teamScopeId?: string;
}

function buildWhereClause(
  params: Partial<FindAllParams>,
  organizationId?: string,
  teamScopeId?: string,
): Prisma.DetectionWhereInput {
  const where: Prisma.DetectionWhereInput = {};
  if (organizationId) where.organizationId = organizationId;

  if (teamScopeId) {
    where.teamId = teamScopeId;
  }

  if (params.status) {
    where.status = params.status as DetectionStatus;
  }

  if (params.cameraId) {
    where.cameraId = params.cameraId;
  }

  if (params.search) {
    where.label = { contains: params.search, mode: "insensitive" };
  }

  if (params.dateFrom || params.dateTo) {
    const timestampFilter: Prisma.DateTimeFilter = {};
    if (params.dateFrom) {
      timestampFilter.gte = new Date(params.dateFrom);
    }
    if (params.dateTo) {
      const end = new Date(params.dateTo);
      end.setHours(23, 59, 59, 999);
      timestampFilter.lte = end;
    }
    where.timestamp = timestampFilter;
  }

  if (params.confidenceMin !== undefined || params.confidenceMax !== undefined) {
    const confidenceFilter: Prisma.FloatFilter = {};
    if (params.confidenceMin !== undefined) {
      confidenceFilter.gte = params.confidenceMin;
    }
    if (params.confidenceMax !== undefined) {
      confidenceFilter.lte = params.confidenceMax;
    }
    where.confidence = confidenceFilter;
  }

  return where;
}

const STATS_CACHE_TTL_MS = 5_000;
const statsCache = new Map<string, { data: unknown; expiresAt: number }>();

async function computeDetectionStats(organizationId?: string, teamScopeId?: string) {
  const scope: Prisma.DetectionWhereInput = organizationId ? { organizationId } : {};
  const camScope: Prisma.CameraWhereInput = organizationId ? { organizationId } : {};
  const orgCond: Prisma.Sql = organizationId
    ? Prisma.sql`AND organization_id = ${organizationId}`
    : Prisma.empty;
  const teamScope: Prisma.DetectionWhereInput = teamScopeId ? { teamId: teamScopeId } : {};
  const teamCamScope: Prisma.CameraWhereInput = teamScopeId ? { teamId: teamScopeId } : {};
  const teamCond: Prisma.Sql = teamScopeId
    ? Prisma.sql`AND team_id = ${teamScopeId}`
    : Prisma.empty;

  const [
    totalDetections,
    criticalAlerts,
    activeCameras,
    recentDetections,
    detectionsOverTime,
    alertsByType,
  ] = await Promise.all([
    prisma.detection.count({ where: { ...scope, ...teamScope } }),
    prisma.detection.count({ where: { ...scope, ...teamScope, status: "critical" } }),
    prisma.camera.count({ where: { ...camScope, ...teamCamScope, status: "online" } }),
    prisma.detection.findMany({
      where: { ...scope, ...teamScope },
      include: { camera: cameraView },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
    prisma.$queryRaw`
      SELECT DATE(timestamp) as date, COUNT(*)::int as count
      FROM detections
      WHERE timestamp >= NOW() - INTERVAL '7 days'
        ${orgCond}
        ${teamCond}
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `,
    prisma.$queryRaw`
      SELECT label, COUNT(*)::int as count
      FROM detections
      WHERE timestamp >= NOW() - INTERVAL '30 days'
        ${orgCond}
        ${teamCond}
      GROUP BY label
      ORDER BY count DESC
      LIMIT 10
    `,
  ]);

  const avgConfidence =
    totalDetections > 0
      ? await prisma.detection
          .aggregate({ _avg: { confidence: true }, where: { ...scope, ...teamScope } })
          .then((r: { _avg: { confidence: number | null } }) => r._avg.confidence ?? 0)
      : 0;

  return {
    totalDetections,
    criticalAlerts,
    activeCameras,
    avgConfidence,
    detectionsOverTime: detectionsOverTime as { date: string; count: number }[],
    alertsByType: alertsByType as { label: string; count: number }[],
    recentDetections,
  };
}

export const detectionService = {
  /**
   * Batch-persists detections produced by one engine frame in a single
   * transaction, then writes the corresponding audit entries in one batch.
   *
   * The engine can emit up to `maxDetectionsPerFrame` detections per frame;
   * persisting them one-by-one previously cost as many sequential DB round
   * trips and audit inserts as there were detections. Batching keeps the
   * writes atomic and bounds the per-frame latency spike.
   */
  async createMany(inputs: Array<Omit<CreateDetectionInput, "skipAlert" | "applyAlertCooldown">>) {
    if (inputs.length === 0) return [];

    // Engine-path tenancy: every row inherits the organization of its camera.
    // Unknown cameras fail the whole batch so no orphaned row can ever be
    // written without a tenant.
    const cameraIds = Array.from(new Set(inputs.map((input) => input.cameraId)));
    const cameras = await prisma.camera.findMany({
      where: { id: { in: cameraIds } },
      select: { id: true, organizationId: true, teamId: true },
    });
    const orgByCamera = new Map(cameras.map((camera) => [camera.id, camera.organizationId]));
    const teamByCamera = new Map(cameras.map((camera) => [camera.id, camera.teamId]));
    for (const cameraId of cameraIds) {
      if (!orgByCamera.has(cameraId)) {
        throw new ApiError(404, `Unknown camera: ${cameraId}`);
      }
    }

    const rows = await prisma.$transaction(
      inputs.map((input) =>
        prisma.detection.create({
          data: {
            cameraId: input.cameraId,
            label: input.label,
            confidence: input.confidence,
            imageUrl: input.imageUrl || "",
            status: input.status ?? deriveDetectionStatus(input.confidence),
            metadata: (input.metadata || {}) as Prisma.InputJsonValue,
            detectorId: input.detectorId,
            detectorKey: input.detectorKey,
            modelVersion: input.modelVersion,
            trackId: input.trackId,
            className: input.className,
            ...(input.boundingBox ? { boundingBox: input.boundingBox as Prisma.InputJsonValue } : {}),
            snapshotUrl: input.snapshotUrl,
            processingTimeMs: input.processingTimeMs,
            organizationId: orgByCamera.get(input.cameraId)!,
            teamId: teamByCamera.get(input.cameraId) ?? null,
          },
          include: { camera: true },
        }),
      ),
    );

    const auditRows = rows.map((row, index) => {
      const audit = {
        id: randomUUID(),
        userId: null,
        username: "",
        email: "",
        action: "detection_created",
        module: "detections",
        description: `Detection created: ${row.label}`,
        ipAddress: "",
        userAgent: "",
        status: "success",
        metadata: {
          detectionId: row.id,
          label: row.label,
          cameraId: row.cameraId,
          detectorKey: inputs[index].detectorKey ?? undefined,
          source: "detector-engine",
        },
        organizationId: row.organizationId,
      } satisfies Prisma.AuditLogCreateManyInput;
      return { ...audit, hash: computeAuditHash(audit) };
    });

    await prisma.auditLog.createMany({ data: auditRows });

    metricsService.recordEvent("detections.created", rows.length);

    return rows;
  },

  async create(input: CreateDetectionInput, callerOrganizationId?: string) {
    // The camera is the tenant root for detections. On authenticated paths
    // the caller's organization must match the camera's; engine paths (no
    // caller) simply inherit the camera organization.
    const camera = await prisma.camera.findFirst({
      where: {
        id: input.cameraId,
        ...(callerOrganizationId ? { organizationId: callerOrganizationId } : {}),
      },
      select: { id: true, name: true, organizationId: true, teamId: true },
    });
    if (!camera) {
      throw new ApiError(404, "Camera not found");
    }
    const organizationId = camera.organizationId;

    const detection = await prisma.detection.create({
      data: {
        cameraId: input.cameraId,
        label: input.label,
        confidence: input.confidence,
        imageUrl: input.imageUrl || "",
        status: input.status ?? deriveDetectionStatus(input.confidence),
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
        detectorId: input.detectorId,
        detectorKey: input.detectorKey,
        modelVersion: input.modelVersion,
        trackId: input.trackId,
        className: input.className,
        ...(input.boundingBox ? { boundingBox: input.boundingBox as Prisma.InputJsonValue } : {}),
        snapshotUrl: input.snapshotUrl,
        processingTimeMs: input.processingTimeMs,
        organizationId,
        teamId: camera.teamId ?? null,
      },
      include: { camera: true },
    });
    metricsService.recordEvent("detections.created");

    // Correlate the fresh detection into an event (best-effort). A missed
    // bucket query must never fail an already-persisted detection.
    let correlationSummary: EventCorrelationSummary | null = null;
    try {
      correlationSummary = await correlationService.correlateSingle({
        id: detection.id,
        cameraId: detection.cameraId,
        detectorKey: detection.detectorKey ?? undefined,
        className: detection.className ?? undefined,
        label: detection.label,
        timestamp: detection.timestamp,
        confidence: detection.confidence,
        trackId: detection.trackId ?? undefined,
      });
      if (correlationSummary?.correlated) {
        detection.metadata = {
          ...((detection.metadata ?? {}) as Record<string, unknown>),
          correlation: correlationSummary,
        } as unknown as Prisma.JsonValue;
      }
    } catch (err) {
      logger.warn("Event correlation skipped for detection", {
        detectionId: detection.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    if (input.skipAlert) {
      return detection;
    }

    if (input.applyAlertCooldown) {
      const key = `${input.detectorKey ?? input.label}:${input.cameraId}:${input.label}`;
      const cooldownMs = await resolveAlertCooldownMs(input.detectorKey);
      if (!alertCooldownRegistry.shouldRaise(key, Date.now(), cooldownMs)) {
        logger.debug("Alert suppressed by cooldown", { key, cooldownMs });
        return detection;
      }
    }

    const severity = getAlertSeverity(detection.status);
    const title = getAlertTitle(detection.label, detection.status);
    const message =
      getAlertMessage(
        detection.label,
        detection.confidence,
        detection.camera?.name,
      ) + correlationMessageSuffix(correlationSummary);

    const alert = await prisma.alert.create({
      data: {
        detectionId: detection.id,
        severity,
        title,
        message,
        organizationId,
      },
    });

    await logAudit({
      action: "alert_created",
      module: "alerts",
      description: `Alert created: ${title}`,
      metadata: { alertId: alert.id, detectionId: detection.id, severity },
      organizationId,
    });

    publishAlertCreated(alert, organizationId);
    void webhookService.dispatchAlertCreated(alert);
    metricsService.recordEvent("alerts.created");

    if (input.applyAlertCooldown) {
      const key = `${input.detectorKey ?? input.label}:${input.cameraId}:${input.label}`;
      alertCooldownRegistry.record(key, Date.now());
    }

    return detection;
  },

  async findAll(params: FindAllParams, organizationId?: string, teamScopeId?: string) {
    const where = buildWhereClause(params, organizationId, teamScopeId);

    const orderBy: Prisma.DetectionOrderByWithRelationInput = {};
    const sortField = params.sortBy || "timestamp";
    (orderBy as Record<string, string>)[sortField] = params.sortOrder || "desc";

    const [data, total] = await Promise.all([
      prisma.detection.findMany({
        where,
        include: { camera: cameraView },
        orderBy: [orderBy],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.detection.count({ where }),
    ]);

    return { data, total };
  },

  async findRecentByDetectorKey(detectorKey: string, limit = 25, organizationId?: string) {
    return prisma.detection.findMany({
      where: { detectorKey, ...(organizationId ? { organizationId } : {}) },
      include: { camera: cameraView },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
  },

  async findById(id: string, organizationId?: string, teamScopeId?: string) {
    const detection = await prisma.detection.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}), ...(teamScopeId ? { teamId: teamScopeId } : {}) },
      include: { camera: cameraView, alert: true },
    });

    if (!detection) {
      throw new ApiError(404, "Detection not found");
    }

    return detection;
  },

  async remove(id: string, organizationId?: string, teamScopeId?: string) {
    const detection = await prisma.detection.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}), ...(teamScopeId ? { teamId: teamScopeId } : {}) },
    });
    if (!detection) {
      throw new ApiError(404, "Detection not found");
    }
    await prisma.alert.deleteMany({ where: { detectionId: id } });
    await prisma.detection.delete({ where: { id } });
    return { success: true, id };
  },

  /**
   * Streaming CSV export. Rows are fetched in bounded pages and yielded so
   * the caller (controller) can write them incrementally instead of loading
   * the whole result set into memory.
   */
  async *streamCSV(params: Partial<FindAllParams>, pageSize = 500, organizationId?: string, teamScopeId?: string) {
    const where = buildWhereClause(params, organizationId, teamScopeId);
    let skip = 0;

    for (;;) {
      const page = await prisma.detection.findMany({
        where,
        include: { camera: cameraView },
        orderBy: [{ timestamp: "desc" }, { id: "desc" }],
        take: pageSize,
        skip,
      });
      if (page.length === 0) return;
      for (const d of page) {
        yield [
          d.id,
          d.timestamp.toISOString(),
          d.label,
          d.confidence.toString(),
          d.status,
          d.camera?.name || "",
          d.camera?.location || "",
          d.imageUrl,
        ];
      }
      skip += page.length;
    }
  },

  async getStats(organizationId?: string, teamScopeId?: string) {
    const cacheKey = organizationId ? `${organizationId}:${teamScopeId ?? "all"}` : undefined;
    const cached = cacheKey ? statsCache.get(cacheKey) : undefined;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as Awaited<ReturnType<typeof computeDetectionStats>>;
    }
    const data = await computeDetectionStats(organizationId, teamScopeId);
    if (cacheKey) {
      statsCache.set(cacheKey, { data, expiresAt: Date.now() + STATS_CACHE_TTL_MS });
    }
    return data;
  },
};
