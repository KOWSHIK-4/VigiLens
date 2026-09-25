import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { monitorScheduler } from "../engine/monitor";
import { logAudit } from "../utils/auditLog";
import { success } from "../utils/apiResponse";
import { userService } from "../services/user.service";

export const monitorController = {
  async getStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Monitoring loops are gathered from the shared detector surface, so a
      // tenant admin only sees their own organization's loops; an instance
      // admin (super_admin) gets the full view.
      const scope = req.userRole === "super_admin" ? undefined : req.organizationId ?? undefined;
      const status = await monitorScheduler.getStatus(scope);
      success(res, status);
    } catch (err) {
      next(err);
    }
  },

  async start(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const scope = req.userRole === "super_admin" ? undefined : req.organizationId ?? undefined;
      const actor = await userService.findById(req.userId!).catch(() => null);
      if (!monitorScheduler.isRunning()) {
        monitorScheduler.start();
        await logAudit({
          userId: req.userId,
          username: actor?.name,
          email: actor?.email,
          action: "monitor_started",
          module: "monitoring",
          description: "Continuous monitoring scheduler started",
          ipAddress: req.ip,
        });
      }
      success(res, await monitorScheduler.getStatus(scope), 200);
    } catch (err) {
      next(err);
    }
  },

  async stop(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const scope = req.userRole === "super_admin" ? undefined : req.organizationId ?? undefined;
      const actor = await userService.findById(req.userId!).catch(() => null);
      if (monitorScheduler.isRunning()) {
        monitorScheduler.stop();
        await logAudit({
          userId: req.userId,
          username: actor?.name,
          email: actor?.email,
          action: "monitor_stopped",
          module: "monitoring",
          description: "Continuous monitoring scheduler stopped",
          ipAddress: req.ip,
        });
      }
      success(res, await monitorScheduler.getStatus(scope), 200);
    } catch (err) {
      next(err);
    }
  },
};
