import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { alertService } from "@/services/alert.service";
import { success, paginated } from "@/utils/apiResponse";

export const alertController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query;
      const page = typeof q.page === "string" ? q.page : "1";
      const limit = typeof q.limit === "string" ? q.limit : "20";
      const severity = typeof q.severity === "string" ? q.severity : undefined;
      const isRead = typeof q.isRead === "string" ? q.isRead : undefined;
      const search = typeof q.search === "string" ? q.search : undefined;

      const result = await alertService.findAll({
        page: parseInt(page),
        limit: parseInt(limit),
        severity,
        isRead,
        search,
      });
      paginated(res, result.data, result.total, parseInt(page), parseInt(limit));
    } catch (err) {
      next(err);
    }
  },

  async markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const alert = await alertService.markAsRead(req.params.id as string);
      success(res, alert);
    } catch (err) {
      next(err);
    }
  },

  async markAllAsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await alertService.markAllAsRead();
      const unreadCount = await alertService.countUnread();
      success(res, { unreadCount });
    } catch (err) {
      next(err);
    }
  },

  async deleteAlert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await alertService.remove(req.params.id as string);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async getUnreadCount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const count = await alertService.countUnread();
      success(res, { count });
    } catch (err) {
      next(err);
    }
  },
};
