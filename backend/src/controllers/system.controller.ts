import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { getRecentLogs } from "../config/logger";
import { healthService } from "../services/health.service";
import { systemService } from "../services/system.service";
import { metricsService } from "../services/metrics.service";
import { success } from "../utils/apiResponse";

const MAX_LOG_LIMIT = 500;

export const systemController = {
  async getHealth(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const report = await healthService.getReadiness();
      success(res, report);
    } catch (err) {
      next(err);
    }
  },

  async getMonitoring(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const report = await systemService.getMonitoring();
      success(res, report);
    } catch (err) {
      next(err);
    }
  },

  async getMetrics(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const report = metricsService.getSnapshot();
      success(res, report);
    } catch (err) {
      next(err);
    }
  },

  async getLogs(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const rawLimit = Number(req.query.limit);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 100;
      const logs = getRecentLogs(Math.min(limit, MAX_LOG_LIMIT));
      success(res, logs);
    } catch (err) {
      next(err);
    }
  },
};
