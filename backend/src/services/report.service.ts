import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { metricsService } from "./metrics.service";
import { buildPdfDocument } from "../utils/pdf";
import { toCsv } from "../utils/csv";
import { ApiError } from "../utils/errors";
import type { Prisma, ReportStatus, ReportType } from "@prisma/client";

interface GenerateReportInput {
  title: string;
  type: ReportType;
  generatedBy: string;
  dateRange: { from: string; to: string };
  organizationId?: string;
}

interface FindAllParams {
  page: number;
  limit: number;
  search?: string;
  type?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

interface DetectionRow {
  id: string;
  label: string;
  confidence: number;
  status: string;
  cameraId: string;
  timestamp: Date;
  camera?: { name: string | null } | null;
}

interface StatusCountRow {
  status: string;
  _count: { id: number };
}

interface CameraRow {
  id: string;
  name: string;
  location: string | null;
  status: string;
  _count: { detections: number };
}

interface AlertRow {
  id: string;
  severity: string;
  title: string;
  message: string;
  createdAt: Date;
  detection?: { camera?: { name: string | null } | null } | null;
}

async function buildReportData(
  type: string,
  dateRange: { from: string; to: string },
  format: "pdf" | "csv",
  organizationId?: string,
): Promise<string | Buffer> {
  const from = new Date(dateRange.from);
  const to = new Date(dateRange.to);
  const where: Prisma.DetectionWhereInput = {
    timestamp: { gte: from, lte: to },
    ...(organizationId ? { organizationId } : {}),
  };

  switch (type) {
    case "daily":
    case "weekly":
    case "monthly": {
      const detections = await prisma.detection.findMany({ where, orderBy: { timestamp: "desc" } });
      const counts = await prisma.detection.groupBy({
        by: ["status"],
        _count: { id: true },
        where,
      });
      return format === "csv" ? buildCsv(detections, counts) : buildPdf(type, dateRange, detections, counts);
    }
    case "camera": {
      const cameras = await prisma.camera.findMany({
        where: organizationId ? { organizationId } : {},
        include: { _count: { select: { detections: { where: { timestamp: { gte: from, lte: to } } } } } },
      });
      return format === "csv" ? buildCameraCsv(cameras) : buildCameraPdf(cameras);
    }
    case "detection": {
      const detections = await prisma.detection.findMany({
        where,
        include: { camera: { select: { id: true, name: true, location: true } } },
        orderBy: { timestamp: "desc" },
      });
      return format === "csv" ? buildDetectionCsv(detections) : buildDetectionPdf(detections);
    }
    case "alert": {
      const alerts = await prisma.alert.findMany({
        where: { createdAt: { gte: from, lte: to }, ...(organizationId ? { organizationId } : {}) },
        include: { detection: { include: { camera: { select: { id: true, name: true, location: true } } } } },
        orderBy: { createdAt: "desc" },
      });
      return format === "csv" ? buildAlertCsv(alerts) : buildAlertPdf(alerts);
    }
    default:
      return "";
  }
}

function buildCsv(detections: DetectionRow[], counts: StatusCountRow[]): string {
  const rows = toCsv(
    ["ID", "Label", "Confidence", "Status", "Camera ID", "Timestamp"],
    detections.map((d) => [d.id, d.label, d.confidence, d.status, d.cameraId, d.timestamp.toISOString()]),
  );
  const summary = "\n\nSummary\n" + toCsv(
    ["Status", "Count"],
    counts.map((c) => [c.status, c._count.id]),
  );
  return rows + summary;
}

function buildPdf(type: string, dateRange: { from: string; to: string }, detections: DetectionRow[], counts: StatusCountRow[]): Buffer {
  return buildPdfDocument(`${type.charAt(0).toUpperCase() + type.slice(1)} Report`, [
    `Period: ${dateRange.from} to ${dateRange.to}`,
    `Total Detections: ${detections.length}`,
    "",
    "Summary by Status:",
    ...counts.map((c) => `  ${c.status}: ${c._count.id}`),
    "",
    ...detections.map((d) => `  [${d.timestamp.toISOString()}] ${d.label} (${(d.confidence * 100).toFixed(0)}%) - ${d.status}`),
  ]);
}

function buildCameraCsv(cameras: CameraRow[]): string {
  return toCsv(
    ["Camera Name", "Location", "Status", "Detection Count"],
    cameras.map((c) => [c.name, c.location || "N/A", c.status, c._count.detections]),
  );
}

function buildCameraPdf(cameras: CameraRow[]): Buffer {
  return buildPdfDocument("Camera Report", [
    "",
    ...cameras.map((c) => `  ${c.name} (${c.location || "N/A"}) - ${c.status} - ${c._count.detections} detections`),
  ]);
}

function buildDetectionCsv(detections: Array<DetectionRow & { camera?: { name: string | null } | null }>): string {
  return toCsv(
    ["ID", "Label", "Confidence", "Status", "Camera", "Timestamp"],
    detections.map((d) => [
      d.id,
      d.label,
      d.confidence,
      d.status,
      d.camera?.name || d.cameraId,
      d.timestamp.toISOString(),
    ]),
  );
}

function buildDetectionPdf(detections: DetectionRow[]): Buffer {
  return buildPdfDocument("Detection Report", [
    "",
    ...detections.map((d) => `  [${d.timestamp.toISOString()}] ${d.label} (${(d.confidence * 100).toFixed(0)}%) - ${d.status} on ${d.camera?.name || "Unknown"}`),
  ]);
}

function buildAlertCsv(alerts: AlertRow[]): string {
  return toCsv(
    ["ID", "Severity", "Title", "Message", "Camera", "Created At"],
    alerts.map((a) => [
      a.id,
      a.severity,
      a.title,
      a.message,
      a.detection?.camera?.name || "N/A",
      a.createdAt.toISOString(),
    ]),
  );
}

function buildAlertPdf(alerts: AlertRow[]): Buffer {
  return buildPdfDocument("Alert Report", [
    "",
    ...alerts.map((a) => `  [${a.createdAt.toISOString()}] ${a.severity.toUpperCase()}: ${a.title} - ${a.message} (${a.detection?.camera?.name || "Unknown"})`),
  ]);
}

function generateReportUrl(type: string, id: string, format: "pdf" | "csv"): string {
  return `/api/reports/download/${id}?format=${format}`;
}

/**
 * Reduces a report title to a safe download filename component: no path
 * separators, control characters, quotes or CR/LF (which could otherwise
 * smuggle extra headers into Content-Disposition).
 */
export function sanitizeReportFilename(title: string): string {
  const cleaned = title
    .replace(/[^A-Za-z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .toLowerCase();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : "report";
}

export const reportService = {
  async generate(input: GenerateReportInput) {
    if (!input.organizationId) {
      throw new ApiError(400, "Organization is required to generate a report");
    }
    const report = await prisma.report.create({
      data: {
        title: input.title,
        type: input.type,
        generatedBy: input.generatedBy,
        dateRange: input.dateRange,
        status: "generating",
        organizationId: input.organizationId,
      },
    });

    process.nextTick(async () => {
      try {
        const format: "pdf" | "csv" = "pdf";
        await buildReportData(input.type, input.dateRange, format, input.organizationId);
        const reportUrl = generateReportUrl(input.type, report.id, format);

        await prisma.report.update({
          where: { id: report.id },
          data: { status: "completed" as ReportStatus, reportUrl },
        });
        logger.info("Report generated", { reportId: report.id });
        metricsService.recordEvent("reports.generated");
      } catch (error) {
        logger.error("Report generation failed", { reportId: report.id, error });
        metricsService.recordEvent("reports.failed");
        await prisma.report.update({
          where: { id: report.id },
          data: { status: "failed" as ReportStatus },
        });
      }
    });

    return report;
  },

  async findAll(params: FindAllParams, organizationId?: string) {
    const where: Prisma.ReportWhereInput = {};
    if (organizationId) where.organizationId = organizationId;

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: "insensitive" } },
      ];
    }

    if (params.type) {
      where.type = params.type as ReportType;
    }

    if (params.status) {
      where.status = params.status as ReportStatus;
    }

    const orderBy: Prisma.ReportOrderByWithRelationInput = {};
    if (params.sortBy) {
      (orderBy as Record<string, string>)[params.sortBy] = params.sortOrder || "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [data, total] = await Promise.all([
      prisma.report.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.report.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string, organizationId?: string) {
    const report = await prisma.report.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!report) throw new ApiError(404, "Report not found");
    return report;
  },

  async remove(id: string, organizationId?: string) {
    const report = await prisma.report.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!report) throw new ApiError(404, "Report not found");
    await prisma.report.delete({ where: { id } });
    return { id };
  },

  async getDownloadData(id: string, format: "pdf" | "csv", organizationId?: string) {
    const report = await prisma.report.findFirst({
      where: { id, ...(organizationId ? { organizationId } : {}) },
    });
    if (!report) throw new ApiError(404, "Report not found");
    if (report.status !== "completed") throw new ApiError(400, "Report not yet completed");

    const dateRange = report.dateRange as { from: string; to: string };
    const content = await buildReportData(report.type, dateRange, format);
    const filename = `${sanitizeReportFilename(report.title)}.${format}`;
    const mimeType = format === "pdf" ? "application/pdf" : "text/csv";

    return { content, filename, mimeType };
  },
};
