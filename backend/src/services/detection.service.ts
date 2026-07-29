import { prisma } from "@/config/prisma";

export const detectionService = {
  async findAll(params: { page: number; limit: number; status?: string }) {
    const where = params.status ? { status: params.status } : {};

    const [data, total] = await Promise.all([
      prisma.detection.findMany({
        where,
        include: { camera: true },
        orderBy: { timestamp: "desc" },
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
            .then((r) => r._avg.confidence ?? 0)
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
