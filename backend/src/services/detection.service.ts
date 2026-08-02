import { prisma } from "@/config/prisma";
import type {
  AlertSeverity,
  DetectionStatus,
  Prisma,
} from "@prisma/client";

interface CreateDetectionInput {
  cameraId: string;
  label: string;
  confidence: number;
  imageUrl?: string;
  metadata?: Record<string, unknown>;
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

function getAlertTitle(label: string, status: string): string {
  const prefix =
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
  confidenceMin?: string;
  confidenceMax?: string;
  sortBy?: string;
  sortOrder?: string;
}

function buildWhereClause(params: Partial<FindAllParams>): Prisma.DetectionWhereInput {
  const where: Prisma.DetectionWhereInput = {};

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

  if (params.confidenceMin || params.confidenceMax) {
    const confidenceFilter: Prisma.FloatFilter = {};
    if (params.confidenceMin) {
      confidenceFilter.gte = parseFloat(params.confidenceMin);
    }
    if (params.confidenceMax) {
      confidenceFilter.lte = parseFloat(params.confidenceMax);
    }
    where.confidence = confidenceFilter;
  }

  return where;
}

export const detectionService = {
  async create(input: CreateDetectionInput) {
    const detection = await prisma.detection.create({
      data: {
        cameraId: input.cameraId,
        label: input.label,
        confidence: input.confidence,
        imageUrl: input.imageUrl || "",
        metadata: (input.metadata || {}) as Prisma.InputJsonValue,
      },
      include: { camera: true },
    });

    const severity = getAlertSeverity(detection.status);
    const title = getAlertTitle(detection.label, detection.status);
    const message = getAlertMessage(
      detection.label,
      detection.confidence,
      detection.camera?.name,
    );

    await prisma.alert.create({
      data: {
        detectionId: detection.id,
        severity,
        title,
        message,
      },
    });

    return detection;
  },

  async findAll(params: FindAllParams) {
    const where = buildWhereClause(params);

    const orderBy: Prisma.DetectionOrderByWithRelationInput = {};
    const sortField = params.sortBy || "timestamp";
    (orderBy as Record<string, string>)[sortField] = params.sortOrder || "desc";

    const [data, total] = await Promise.all([
      prisma.detection.findMany({
        where,
        include: { camera: true },
        orderBy: [orderBy],
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.detection.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string) {
    const detection = await prisma.detection.findUnique({
      where: { id },
      include: { camera: true, alert: true },
    });

    if (!detection) {
      throw new Error("Detection not found");
    }

    return detection;
  },

  async exportCSV(params: Partial<FindAllParams>) {
    const where = buildWhereClause(params);

    const detections = await prisma.detection.findMany({
      where,
      include: { camera: true },
      orderBy: { timestamp: "desc" },
    });

    const headers = ["ID", "Timestamp", "Label", "Confidence", "Status", "Camera", "Location", "Image URL"];
    const rows = detections.map((d: { id: string; timestamp: Date; label: string; confidence: number; status: string; imageUrl: string; camera?: { name: string; location: string | null } | null }) => [
      d.id,
      d.timestamp.toISOString(),
      d.label,
      d.confidence.toString(),
      d.status,
      d.camera?.name || "",
      d.camera?.location || "",
      d.imageUrl,
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row: string[]) => row.map((cell: string) => `"${cell.replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    return csvContent;
  },

  async getStats() {
    const [
      totalDetections,
      criticalAlerts,
      activeCameras,
      recentDetections,
      detectionsOverTime,
      alertsByType,
    ] = await Promise.all([
      prisma.detection.count(),
      prisma.detection.count({ where: { status: "critical" } }),
      prisma.camera.count({ where: { status: "online" } }),
      prisma.detection.findMany({
        include: { camera: true },
        orderBy: { timestamp: "desc" },
        take: 10,
      }),
      prisma.$queryRaw`
        SELECT DATE(timestamp) as date, COUNT(*)::int as count
        FROM detections
        WHERE timestamp >= NOW() - INTERVAL '7 days'
        GROUP BY DATE(timestamp)
        ORDER BY date ASC
      `,
      prisma.$queryRaw`
        SELECT label, COUNT(*)::int as count
        FROM detections
        WHERE timestamp >= NOW() - INTERVAL '30 days'
        GROUP BY label
        ORDER BY count DESC
        LIMIT 10
      `,
    ]);

    const avgConfidence =
      totalDetections > 0
        ? await prisma.detection
            .aggregate({ _avg: { confidence: true } })
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
  },
};
