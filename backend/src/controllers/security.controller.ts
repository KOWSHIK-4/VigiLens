import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { securityDashboardService } from "../services/securityDashboard.service";
import { auditLogService } from "../services/auditLog.service";
import { intelligenceService } from "../services/intelligenceLoader.service";
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

  async getAuditIntegrity(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await auditLogService.verifyIntegrity();
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getIntelligence(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const windowMs = Number(req.query.windowMs);
      const report = await intelligenceService.analyze(
        Number.isFinite(windowMs) ? windowMs : undefined,
      );
      success(res, report);
    } catch (err) {
      next(err);
    }
  },

  async getIntelligenceContext(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const windowMs = Number(req.query.windowMs);
      const context = await intelligenceService.context(
        Number.isFinite(windowMs) ? windowMs : undefined,
      );
      success(res, context);
    } catch (err) {
      next(err);
    }
  },
};