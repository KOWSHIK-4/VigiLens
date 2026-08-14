import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { monitorScheduler } from "@/engine/monitor";
import { logAudit } from "@/utils/auditLog";
import { success } from "@/utils/apiResponse";
import { userService } from "@/services/user.service";

export const monitorController = {
  async getStatus(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = await monitorScheduler.getStatus();
      success(res, status);
    } catch (err) {
      next(err);
    }
  },

  async start(req: AuthRequest, res: Response, next: NextFunction) {
    try {
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
      success(res, await monitorScheduler.getStatus(), 200);
    } catch (err) {
      next(err);
    }
  },

  async stop(req: AuthRequest, res: Response, next: NextFunction) {
    try {
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
      success(res, await monitorScheduler.getStatus(), 200);
    } catch (err) {
      next(err);
    }
  },
};
