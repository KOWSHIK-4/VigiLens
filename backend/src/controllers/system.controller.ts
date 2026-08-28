import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { healthService } from "../services/health.service";
import { systemService } from "../services/system.service";
import { metricsService } from "../services/metrics.service";
import { success } from "../utils/apiResponse";

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
};
