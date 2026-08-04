import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import type { AuditLogAction } from "@prisma/client";
import { auditLogService } from "@/services/auditLog.service";
import { success, paginated, error } from "@/utils/apiResponse";

export const auditLogController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await auditLogService.findAll({
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 20,
        search: req.query.search as string | undefined,
        userId: req.query.userId as string | undefined,
        action: req.query.action as AuditLogAction | undefined,
        module: req.query.module as string | undefined,
        status: req.query.status as "success" | "failed" | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
        sortBy: req.query.sortBy as "timestamp" | "action" | "module" | "status" | "username" | "email" | undefined,
        sortOrder: req.query.sortOrder as "asc" | "desc" | undefined,
      });

      paginated(res, result.data, result.total, result.page, result.limit);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const log = await auditLogService.findById(id);

      if (!log) {
        return error(res, "Audit log not found", 404);
      }

      success(res, log);
    } catch (err) {
      next(err);
    }
  },

  async exportCSV(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const csv = await auditLogService.exportCSV({
        page: 1,
        limit: 10000,
        search: req.query.search as string | undefined,
        userId: req.query.userId as string | undefined,
        action: req.query.action as AuditLogAction | undefined,
        module: req.query.module as string | undefined,
        status: req.query.status as "success" | "failed" | undefined,
        dateFrom: req.query.dateFrom as string | undefined,
        dateTo: req.query.dateTo as string | undefined,
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=audit-logs.csv");
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },

  async getStats(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await auditLogService.getStats();
      success(res, stats);
    } catch (err) {
      next(err);
    }
  },

  async getChartData(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const data = await auditLogService.getChartData();
      success(res, data);
    } catch (err) {
      next(err);
    }
  },
};
