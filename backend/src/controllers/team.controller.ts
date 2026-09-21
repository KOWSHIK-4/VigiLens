import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  AssignTeamMemberInput,
  CreateTeamInput,
  TeamQueryInput,
  UpdateTeamInput,
} from "../types";
import { teamService } from "../services/team.service";
import { userService } from "../services/user.service";
import { success, paginated } from "../utils/apiResponse";
import { logAudit } from "../utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const teamController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as TeamQueryInput;
      const result = await teamService.findAll({
        page: q.page,
        limit: q.limit,
        search: q.search,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
      }, req.organizationId);
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const team = await teamService.findById(req.params.id as string, req.organizationId);
      success(res, team);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const team = await teamService.create(req.body as CreateTeamInput, req.organizationId);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "team_created",
        module: "teams",
        description: `Team created: ${team.name}`,
        organizationId: req.organizationId,
        ...info,
        metadata: { teamId: team.id, name: team.name },
      });
      success(res, team, 201);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const team = await teamService.update(
        req.params.id as string,
        req.body as UpdateTeamInput,
        req.organizationId,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "team_updated",
        module: "teams",
        description: `Team updated: ${team.name}`,
        organizationId: req.organizationId,
        ...info,
        metadata: { teamId: team.id, fields: Object.keys(req.body) },
      });
      success(res, team);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const team = await teamService.remove(req.params.id as string, req.organizationId);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "team_deleted",
        module: "teams",
        description: `Team deleted: ${req.params.id}`,
        organizationId: req.organizationId,
        ...info,
        metadata: { teamId: req.params.id },
      });
      success(res, team);
    } catch (err) {
      next(err);
    }
  },

  async assignMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { userId } = req.body as AssignTeamMemberInput;
      const result = await teamService.assignMember(
        req.params.id as string,
        userId,
        req.organizationId,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      const target = await userService.findById(userId).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "team_member_assigned",
        module: "teams",
        description: `User ${target?.email || userId} assigned to team ${result.teamId}`,
        organizationId: req.organizationId,
        ...info,
        metadata: { teamId: result.teamId, userId },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async removeMember(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.params.userId as string;
      const result = await teamService.removeMember(
        req.params.id as string,
        userId,
        req.organizationId,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      const target = await userService.findById(userId).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "team_member_removed",
        module: "teams",
        description: `User ${target?.email || userId} removed from team ${result.teamId}`,
        organizationId: req.organizationId,
        ...info,
        metadata: { teamId: result.teamId, userId },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },
};