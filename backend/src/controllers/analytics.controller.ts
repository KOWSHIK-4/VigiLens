import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { analyticsService } from "@/services/analytics.service";
import { success } from "@/utils/apiResponse";

export const analyticsController = {
  async getOverview(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getOverview();
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getDaily(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getDaily({
        period: req.query.period as "7" | "30" | "90" | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getCameras(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getCameras({
        period: req.query.period as "7" | "30" | "90" | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getDetectors(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getDetectors({
        period: req.query.period as "7" | "30" | "90" | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getTimeline(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getTimeline({
        period: req.query.period as "7" | "30" | "90" | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getConfidenceDistribution(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getConfidenceDistribution({
        period: req.query.period as "7" | "30" | "90" | undefined,
        from: req.query.from as string | undefined,
        to: req.query.to as string | undefined,
      });
      success(res, data);
    } catch (err) {
      next(err);
    }
  },
};
