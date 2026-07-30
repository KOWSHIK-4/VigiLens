import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import type { Prisma } from "@prisma/client";

interface GenerateReportInput {
  title: string;
  type: "daily" | "weekly" | "monthly" | "camera" | "detection" | "alert";
  generatedBy: string;
  dateRange: { from: string; to: string };
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

async function buildReportData(type: string, dateRange: { from: string; to: string }, format: "pdf" | "csv"): Promise<string> {
  const from = new Date(dateRange.from);
  const to = new Date(dateRange.to);
  const where: Prisma.DetectionWhereInput = { timestamp: { gte: from, lte: to } };

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
        include: { _count: { select: { detections: { where: { timestamp: { gte: from, lte: to } } } } } },
      });
      return format === "csv" ? buildCameraCsv(cameras) : buildCameraPdf(cameras);
    }
    case "detection": {
      const detections = await prisma.detection.findMany({
        where,
        include: { camera: true },
        orderBy: { timestamp: "desc" },
      });
      return format === "csv" ? buildDetectionCsv(detections) : buildDetectionPdf(detections);
    }
    case "alert": {
      const alerts = await prisma.alert.findMany({
        where: { createdAt: { gte: from, lte: to } },
        include: { detection: { include: { camera: true } } },
        orderBy: { createdAt: "desc" },
      });
      return format === "csv" ? buildAlertCsv(alerts) : buildAlertPdf(alerts);
    }
    default:
      return "";
  }
}

function buildCsv(detections: any[], counts: any[]): string {
  const header = "ID,Label,Confidence,Status,Camera ID,Timestamp";
  const rows = detections.map((d) => `${d.id},${d.label},${d.confidence},${d.status},${d.cameraId},${d.timestamp}`);
  const summary = `\n\nSummary\nStatus,Count\n${counts.map((c) => `${c.status},${c._count.id}`).join("\n")}`;
  return header + "\n" + rows.join("\n") + summary;
}

function buildPdf(type: string, dateRange: { from: string; to: string }, detections: any[], counts: any[]): string {
  const summary = counts.map((c) => `  ${c.status}: ${c._count.id}`).join("\n");
  return [
    `${type.charAt(0).toUpperCase() + type.slice(1)} Report`,
    `Period: ${dateRange.from} to ${dateRange.to}`,
    `Total Detections: ${detections.length}`,
    "",
    "Summary by Status:",
    summary,
    "",
    ...detections.map((d) => `  [${d.timestamp}] ${d.label} (${(d.confidence * 100).toFixed(0)}%) - ${d.status}`),
  ].join("\n");
}

function buildCameraCsv(cameras: any[]): string {
  const header = "Camera Name,Location,Status,Detection Count";
  const rows = cameras.map((c) => `${c.name},${c.location || "N/A"},${c.status},${c._count.detections}`);
  return header + "\n" + rows.join("\n");
}

function buildCameraPdf(cameras: any[]): string {
  return [
    "Camera Report",
    "",
    ...cameras.map((c) => `  ${c.name} (${c.location || "N/A"}) - ${c.status} - ${c._count.detections} detections`),
  ].join("\n");
}

function buildDetectionCsv(detections: any[]): string {
  const header = "ID,Label,Confidence,Status,Camera,Timestamp";
  const rows = detections.map((d) => `${d.id},${d.label},${d.confidence},${d.status},${d.camera?.name || d.cameraId},${d.timestamp}`);
  return header + "\n" + rows.join("\n");
}

function buildDetectionPdf(detections: any[]): string {
  return [
    "Detection Report",
    "",
    ...detections.map((d) => `  [${d.timestamp}] ${d.label} (${(d.confidence * 100).toFixed(0)}%) - ${d.status} on ${d.camera?.name || "Unknown"}`),
  ].join("\n");
}

function buildAlertCsv(alerts: any[]): string {
  const header = "ID,Severity,Title,Message,Camera,Created At";
  const rows = alerts.map((a) => `${a.id},${a.severity},${a.title},${a.message},${a.detection?.camera?.name || "N/A"},${a.createdAt}`);
  return header + "\n" + rows.join("\n");
}

function buildAlertPdf(alerts: any[]): string {
  return [
    "Alert Report",
    "",
    ...alerts.map((a) => `  [${a.createdAt}] ${a.severity.toUpperCase()}: ${a.title} - ${a.message} (${a.detection?.camera?.name || "Unknown"})`),
  ].join("\n");
}

function generateReportUrl(type: string, id: string, format: "pdf" | "csv"): string {
  return `/api/reports/download/${id}?format=${format}`;
}

export const reportService = {
  async generate(input: GenerateReportInput) {
    const report = await prisma.report.create({
      data: {
        title: input.title,
        type: input.type as any,
        generatedBy: input.generatedBy,
        dateRange: input.dateRange,
        status: "generating",
      },
    });

    process.nextTick(async () => {
      try {
        const format: "pdf" | "csv" = "pdf";
        const content = await buildReportData(input.type, input.dateRange, format);
        const reportUrl = generateReportUrl(input.type, report.id, format);

        await prisma.report.update({
          where: { id: report.id },
          data: { status: "completed", reportUrl },
        });
        logger.info("Report generated", { reportId: report.id });
      } catch (error) {
        logger.error("Report generation failed", { reportId: report.id, error });
        await prisma.report.update({
          where: { id: report.id },
          data: { status: "failed" },
        });
      }
    });

    return report;
  },

  async findAll(params: FindAllParams) {
    const where: Record<string, unknown> = {};

    if (params.search) {
      where.OR = [
        { title: { contains: params.search, mode: "insensitive" } },
      ];
    }

    if (params.type) {
      where.type = params.type;
    }

    if (params.status) {
      where.status = params.status;
    }

    const orderBy: Record<string, string> = {};
    if (params.sortBy) {
      orderBy[params.sortBy] = params.sortOrder || "desc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [data, total] = await Promise.all([
      prisma.report.findMany({
        where: where as any,
        orderBy: orderBy as any,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.report.count({ where: where as any }),
    ]);

    return { data, total };
  },

  async findById(id: string) {
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new Error("Report not found");
    return report;
  },

  async remove(id: string) {
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new Error("Report not found");
    await prisma.report.delete({ where: { id } });
    return { id };
  },

  async getDownloadData(id: string, format: "pdf" | "csv") {
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new Error("Report not found");
    if (report.status !== "completed") throw new Error("Report not yet completed");

    const dateRange = report.dateRange as { from: string; to: string };
    const content = await buildReportData(report.type, dateRange, format);
    const filename = `${report.title.replace(/\s+/g, "_").toLowerCase()}.${format}`;
    const mimeType = format === "pdf" ? "application/pdf" : "text/csv";

    return { content, filename, mimeType };
  },
};
