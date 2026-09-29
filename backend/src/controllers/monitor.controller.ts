import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { monitorScheduler } from "../engine/monitor";
import { logAudit } from "../utils/auditLog";
import { success } from "../utils/apiResponse";
import { userService } from "../services/user.service";
import { ApiError } from "../utils/errors";

/**
 * The scheduler is a process-wide singleton: MonitorScheduler holds one
 * `running` flag and one timer for the whole process, and loadLoops gathers
 * loops from every tenant's detectors. Starting and stopping it is therefore
 * an instance-wide action, not a tenant-scoped one.
 *
 * Reading status is still per-tenant (see getStatus), but mutating the
 * singleton must be limited to an instance administrator. Otherwise a tenant
 * admin holding monitoring.manage can stop continuous detection for every
 * other organization on the instance, and start it back up afterwards.
 */
function assertInstanceSchedulerControl(req: AuthRequest): void {
  if (req.userRole !== "super_admin") {
    throw new ApiError(
      403,
      "The monitoring scheduler is instance-wide and can only be started or stopped by a Super Admin",
    );
  }
}

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
      assertInstanceSchedulerControl(req);
      // Only a super_admin reaches this point, so the status is the
      // instance-wide view: the singleton's own scope, not a tenant's.
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
      success(res, await monitorScheduler.getStatus(undefined), 200);
    } catch (err) {
      next(err);
    }
  },

  async stop(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      assertInstanceSchedulerControl(req);
      // Instance-wide view, for the same reason as start().
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
      success(res, await monitorScheduler.getStatus(undefined), 200);
    } catch (err) {
      next(err);
    }
  },
};
