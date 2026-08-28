import type { Response, NextFunction } from "express";
import type { AlertQueryInput, AuthRequest } from "../types";
import { alertService } from "../services/alert.service";
import { success, paginated } from "../utils/apiResponse";

export const alertController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as AlertQueryInput;
      const result = await alertService.findAll(q);
      paginated(res, result.data, result.total, q.page, q.limit);
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
