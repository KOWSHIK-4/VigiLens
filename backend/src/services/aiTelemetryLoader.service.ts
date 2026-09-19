import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { metricsService } from "./metrics.service";
import { aiDetectorModel } from "../engine/modelCatalog";
import {
  aggregateAITelemetry,
  type AITelemetrySummary,
} from "./aiTelemetry";

const TELEMETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Loads real telemetry and aggregates it. All numbers come from live
 * records — no synthetic values are ever reported.
 */
async function loadTelemetryInput() {
  const snapshot = metricsService.getSnapshot();
  const operations = snapshot.operations.counters;

  const [registeredModels, activeModels, recentDetectionCount] = await Promise.all([
    prisma.aIModel.count(),
    prisma.aIModel.count({ where: { enabled: true, status: "loaded" } }),
    prisma.detection.count({
      where: { timestamp: { gte: new Date(Date.now() - TELEMETRY_WINDOW_MS) } },
    }),
  ]);

  const engineModelNames: string[] = [];
  for (const key of ["person", "vehicle", "crowd", "smoke", "fire"]) {
    const mapped = aiDetectorModel(key);
    if (mapped) engineModelNames.push(mapped);
  }

  return {
    testSuccessCount: operations["model.tests.succeeded"] ?? 0,
    testFailureCount: operations["model.tests.failed"] ?? 0,
    averageLatencyMs: snapshot.detections.averageProcessingTimeMs,
    latencySampleCount: snapshot.detections.total,
    registeredModelCount: registeredModels,
    activeModelCount: activeModels,
    engineModelNames: [...new Set(engineModelNames)],
    recentDetectionCount,
    uptimeMs: snapshot.uptime.sinceStartedSeconds * 1000,
  };
}

export const aiTelemetryService = {
  async getSummary(): Promise<AITelemetrySummary> {
    try {
      const input = await loadTelemetryInput();
      return aggregateAITelemetry(input);
    } catch (err) {
      logger.error("AI telemetry failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },

  aggregateAITelemetry,
};