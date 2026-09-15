import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { securityDashboardService } from "../services/securityDashboard.service";
import { success } from "../utils/apiResponse";

export const securityController = {
  async getDashboard(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dashboard = await securityDashboardService.getDashboard();
      success(res, dashboard);
    } catch (err) {
      next(err);
    }
  },
};