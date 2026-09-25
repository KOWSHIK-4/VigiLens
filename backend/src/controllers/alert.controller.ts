import type { Response, NextFunction } from "express";
import type { AlertQueryInput, AssignAlertTeamInput, AuthRequest } from "../types";
import { alertService } from "../services/alert.service";
import { userService } from "../services/user.service";
import { success, paginated } from "../utils/apiResponse";
import { logAudit } from "../utils/auditLog";
import { sendCsvStream } from "../utils/csvStream";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const alertController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as AlertQueryInput;
      const result = await alertService.findAll(q, req.organizationId);
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async exportCsv(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as AlertQueryInput;
      res.setHeader("Content-Disposition", `attachment; filename=alerts-${Date.now()}.csv`);
      await sendCsvStream(
        res,
        ["ID", "Severity", "Title", "Message", "Camera", "Location", "Timestamp", "Read"],
        alertService.streamCSV(q, 500, req.organizationId),
      );
    } catch (err) {
      if (!res.headersSent) next(err);
    }
  },

  async markAsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const alert = await alertService.markAsRead(req.params.id as string, req.organizationId, req.teamScopeId);
      success(res, alert);
    } catch (err) {
      next(err);
    }
  },

  async acknowledge(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const actor = await userService.findById(req.userId!).catch(() => null);
      const alert = await alertService.acknowledge(req.params.id as string, {
        id: req.userId!,
        name: actor?.name ?? "Unknown user",
      }, req.organizationId, req.teamScopeId);
      const info = getClientInfo(req);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "alert_acknowledged",
        module: "alerts",
        description: `Alert acknowledged: ${alert.title}`,
        ...info,
        metadata: { alertId: alert.id, title: alert.title, severity: alert.severity },
      });
      success(res, alert);
    } catch (err) {
      next(err);
    }
  },

  async escalate(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const actor = await userService.findById(req.userId!).catch(() => null);
      const alert = await alertService.escalate(req.params.id as string, {
        id: req.userId!,
        name: actor?.name ?? "Unknown user",
      }, (req.body as { note?: string } | undefined)?.note, req.organizationId, req.teamScopeId);
      const info = getClientInfo(req);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "alert_escalated",
        module: "alerts",
        description: `Alert escalated: ${alert.title}`,
        ...info,
        metadata: { alertId: alert.id, title: alert.title, severity: alert.severity },
      });
      success(res, alert);
    } catch (err) {
      next(err);
    }
  },

  async markAllAsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      await alertService.markAllAsRead(req.organizationId, req.teamScopeId);
      const unreadCount = await alertService.countUnread(req.organizationId, req.teamScopeId);
      success(res, { unreadCount });
    } catch (err) {
      next(err);
    }
  },

  async deleteAlert(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await alertService.remove(req.params.id as string, req.organizationId, req.teamScopeId);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async assignTeam(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { teamId } = req.body as AssignAlertTeamInput;
      const alert = (await alertService.assignTeam(req.params.id as string, teamId, req.organizationId, req.teamScopeId))!;
      const actor = await userService.findById(req.userId!).catch(() => null);
      const info = getClientInfo(req);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "alert_team_assigned",
        module: "alerts",
        description: teamId ? `Alert routed to team: ${alert.team?.name || teamId}` : "Alert team cleared",
        ...info,
        metadata: { alertId: alert.id, teamId },
      });
      success(res, alert);
    } catch (err) {
      next(err);
    }
  },

  async getUnreadCount(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      // Single grouped query serves both the total and the per-severity
      // breakdown, so the dashboard only needs one polling request.
      const [count, bySeverity] = await Promise.all([
        alertService.countUnread(req.organizationId, req.teamScopeId),
        alertService.countUnreadBySeverity(req.organizationId, req.teamScopeId),
      ]);
      success(res, { count, bySeverity });
    } catch (err) {
      next(err);
    }
  },
};
