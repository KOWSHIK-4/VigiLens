import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { securityDashboardService } from "../services/securityDashboard.service";
import { auditLogService } from "../services/auditLog.service";
import { intelligenceService } from "../services/intelligenceLoader.service";
import { success } from "../utils/apiResponse";

export const securityController = {
  async getDashboard(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const dashboard = await securityDashboardService.getDashboard(req.organizationId);
      success(res, dashboard);
    } catch (err) {
      next(err);
    }
  },

  async getAuditIntegrity(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Audit rows carry a tenant organization, so an integrity report from
      // an organization admin must be scoped to that tenant (an instance
      // admin gets the full picture).
      const scope = req.userRole === "super_admin" ? undefined : req.organizationId ?? undefined;
      const result = await auditLogService.verifyIntegrity(100_000, scope);
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
        req.organizationId,
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
        req.organizationId,
      );
      success(res, context);
    } catch (err) {
      next(err);
    }
  },
};