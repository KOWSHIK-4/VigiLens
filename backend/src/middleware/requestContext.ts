import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "@/config/logger";
import { metricsService } from "@/services/metrics.service";

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    res.locals.requestDurationMs = durationMs;

    const statusCode = res.statusCode;
    const logLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";

    logger.log(logLevel, "HTTP request", {
      requestId,
      method: req.method,
      endpoint: req.originalUrl || req.url,
      statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userAgent: req.headers["user-agent"],
    });

    const endpoint = req.originalUrl || req.url || "";
    if (endpoint.startsWith("/api") && !endpoint.startsWith("/api/system/metrics")) {
      metricsService.recordRequest(durationMs, statusCode);
    }
  });

  next();
}
