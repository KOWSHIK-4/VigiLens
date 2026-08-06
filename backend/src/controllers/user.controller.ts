import type { Response, NextFunction } from "express";
import type {
  AuthRequest,
  CreateUserInput,
  ResetPasswordInput,
  UpdateUserInput,
  UserQueryInput,
} from "@/types";
import { userService } from "@/services/user.service";
import { success, paginated } from "@/utils/apiResponse";
import { logAudit } from "@/utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const userController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const q = req.query as unknown as UserQueryInput;
      const result = await userService.findAll({
        page: q.page,
        limit: q.limit,
        search: q.search,
        role: q.role,
        status: q.status,
        sortBy: q.sortBy,
        sortOrder: q.sortOrder,
      });
      paginated(res, result.data, result.total, q.page, q.limit);
    } catch (err) {
      next(err);
    }
  },

  async getStats(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const stats = await userService.stats();
      success(res, stats);
    } catch (err) {
      next(err);
    }
  },

  async getById(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.findById(req.params.id as string);
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.create(req.body as CreateUserInput);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "user_created",
        module: "users",
        description: `User created: ${user.email} (${user.role})`,
        ...info,
        metadata: { targetUserId: user.id, email: user.email, role: user.role },
      });
      success(res, user, 201);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.update(
        req.params.id as string,
        req.body as UpdateUserInput,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "user_updated",
        module: "users",
        description: `User updated: ${user.email}`,
        ...info,
        metadata: { targetUserId: user.id, email: user.email, fields: Object.keys(req.body) },
      });
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const targetUser = await userService.findById(req.params.id as string).catch(() => null);
      const result = await userService.remove(
        req.params.id as string,
        req.userId,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "user_deleted",
        module: "users",
        description: `User deleted: ${targetUser?.email || req.params.id}`,
        ...info,
        metadata: { targetUserId: req.params.id, email: targetUser?.email },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async assignRole(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const targetUser = await userService.findById(req.params.id as string).catch(() => null);
      const user = await userService.assignRole(
        req.params.id as string,
        req.body.role as string,
        req.userId,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "role_changed",
        module: "users",
        description: `Role changed for ${targetUser?.email || req.params.id}: ${targetUser?.role} → ${user.role}`,
        ...info,
        metadata: { targetUserId: user.id, email: user.email, oldRole: targetUser?.role, newRole: user.role },
      });
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async setStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.setStatus(
        req.params.id as string,
        req.body.status as "active" | "disabled",
        req.userId,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "user_updated",
        module: "users",
        description: `User ${user.status === "active" ? "enabled" : "disabled"}: ${user.email}`,
        ...info,
        metadata: { targetUserId: user.id, email: user.email, status: user.status },
      });
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async lock(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const targetUser = await userService.findById(req.params.id as string).catch(() => null);
      const user = await userService.lock(req.params.id as string, req.userId);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "user_locked",
        module: "users",
        description: `User locked: ${targetUser?.email || req.params.id}`,
        ...info,
        metadata: { targetUserId: user.id, email: targetUser?.email },
      });
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async unlock(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const targetUser = await userService.findById(req.params.id as string).catch(() => null);
      const user = await userService.unlock(req.params.id as string, req.userId);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "user_unlocked",
        module: "users",
        description: `User unlocked: ${targetUser?.email || req.params.id}`,
        ...info,
        metadata: { targetUserId: user.id, email: targetUser?.email },
      });
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await userService.resetPassword(
        req.params.id as string,
        req.body as ResetPasswordInput,
      );
      const info = getClientInfo(req);
      const targetUser = await userService.findById(req.params.id as string).catch(() => null);
      const actor = await userService.findById(req.userId!).catch(() => null);
      const body = req.body as ResetPasswordInput;
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "password_reset",
        module: "users",
        description: `Password reset for ${targetUser?.email || req.params.id}`,
        ...info,
        metadata: {
          targetUserId: req.params.id,
          email: targetUser?.email,
          mustChangePassword: body.mustChangePassword ?? false,
        },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },
};
