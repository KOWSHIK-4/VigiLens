import type { Response, NextFunction } from "express";
import type { AnalyticsQueryInput, AuthRequest } from "@/types";
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
      const data = await analyticsService.getDaily((req.query as unknown as AnalyticsQueryInput));
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getCameras(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getCameras((req.query as unknown as AnalyticsQueryInput));
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getDetectors(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getDetectors((req.query as unknown as AnalyticsQueryInput));
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getTimeline(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getTimeline((req.query as unknown as AnalyticsQueryInput));
      success(res, data);
    } catch (err) {
      next(err);
    }
  },

  async getConfidenceDistribution(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await analyticsService.getConfidenceDistribution((req.query as unknown as AnalyticsQueryInput));
      success(res, data);
    } catch (err) {
      next(err);
    }
  },
};
