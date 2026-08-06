import type { Response, NextFunction } from "express";
import { authService } from "@/services/auth.service";
import { success, error } from "@/utils/apiResponse";
import type { AuthRequest, ChangePasswordInput } from "@/types";
import { logger } from "@/config/logger";
import { logAudit } from "@/utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const authController = {
  async register(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body);
      const info = getClientInfo(req);
      await logAudit({
        action: "user_created",
        module: "auth",
        description: `New user registered: ${result.user.email}`,
        ...info,
        metadata: { email: result.user.email, name: result.user.name },
      });
      logger.info(`User registered: ${result.user.email}`);
      success(res, result, 201);
    } catch (err) {
      const info = getClientInfo(req);
      await logAudit({
        action: "user_created",
        module: "auth",
        description: `Registration failed for ${req.body?.email || "unknown"}`,
        ...info,
        status: "failed",
        metadata: { email: req.body?.email, error: err instanceof Error ? err.message : "Unknown error" },
      });
      if (err instanceof Error && err.message === "Email already in use") {
        return error(res, err.message, 409);
      }
      next(err);
    }
  },

  async login(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body);
      const info = getClientInfo(req);
      await logAudit({
        userId: result.user.id,
        username: result.user.name,
        email: result.user.email,
        action: "user_login",
        module: "auth",
        description: `User logged in: ${result.user.email}`,
        ...info,
      });
      logger.info(`User logged in: ${result.user.email}`);
      success(res, result);
    } catch (err) {
      const info = getClientInfo(req);
      await logAudit({
        action: "user_login",
        module: "auth",
        description: `Login failed for ${req.body?.email || "unknown"}`,
        ...info,
        status: "failed",
        metadata: { email: req.body?.email, error: err instanceof Error ? err.message : "Unknown error" },
      });
      if (
        err instanceof Error &&
        (err.message === "Invalid email or password" ||
          err.message === "Account disabled. Contact your administrator")
      ) {
        return error(res, err.message, 401);
      }
      if (
        err instanceof Error &&
        err.message === "Account locked. Contact your administrator"
      ) {
        return error(res, err.message, 403);
      }
      next(err);
    }
  },

  async me(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const user = await authService.me(req.userId!);
      success(res, user);
    } catch (err) {
      next(err);
    }
  },

  async changePassword(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.changePassword(
        req.userId!,
        req.body as ChangePasswordInput,
      );
      const info = getClientInfo(req);
      const user = await authService.me(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: user?.name || "",
        email: user?.email || "",
        action: "password_changed",
        module: "auth",
        description: `Password changed for ${user?.email || req.userId}`,
        ...info,
      });
      logger.info(`Password changed: ${user?.email || req.userId}`);
      success(res, result);
    } catch (err) {
      const info = getClientInfo(req);
      if (err instanceof Error && err.message === "Current password is incorrect") {
        await logAudit({
          userId: req.userId,
          action: "password_changed",
          module: "auth",
          description: "Password change rejected: incorrect current password",
          ...info,
          status: "failed",
        });
        return error(res, err.message, 400);
      }
      next(err);
    }
  },

  async logout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const info = getClientInfo(req);
      const user = await authService.me(req.userId!);
      await logAudit({
        userId: user.id,
        username: user.name,
        email: user.email,
        action: "user_logout",
        module: "auth",
        description: `User logged out: ${user.email}`,
        ...info,
      });
      logger.info(`User logged out: ${user.email}`);
      success(res, { message: "Logged out successfully" });
    } catch (err) {
      next(err);
    }
  },
};
