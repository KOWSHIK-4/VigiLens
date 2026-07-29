import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { detectionService } from "@/services/detection.service";
import { success, paginated } from "@/utils/apiResponse";

export const detectionController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit, status } = req.query as {
        page: string;
        limit: string;
        status?: string;
      };
      const result = await detectionService.findAll({
        page: parseInt(page || "1"),
        limit: parseInt(limit || "20"),
        status,
      });
      paginated(
        res,
        result.data,
        result.total,
        parseInt(page || "1"),
        parseInt(limit || "20"),
      );
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const detection = await detectionService.findById(req.params.id);
      success(res, detection);
    } catch (err) {
      next(err);
    }
  },

  async getStats(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await detectionService.getStats();
      success(res, stats);
    } catch (err) {
      next(err);
    }
  },
};
