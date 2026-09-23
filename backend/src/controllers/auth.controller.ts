import type { Response, NextFunction } from "express";
import { authService } from "../services/auth.service";
import { settingsService } from "../services/settings.service";
import { success, error } from "../utils/apiResponse";
import type { AuthRequest, ChangePasswordInput } from "../types";
import { config } from "../config";
import { logger } from "../config/logger";
import { logAudit } from "../utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

/**
 * Determines whether credentials would travel over cleartext. An explicit
 * ``X-Forwarded-Proto`` of ``http`` is authoritative (the proxy chain says the
 * client spoke plain HTTP); without any proxy header only a production server
 * is treated as exposed, so local development and tests are never blocked.
 */
function isCleartextRequest(req: AuthRequest): boolean {
  if (req.secure) return false;
  const forwarded = (req.headers["x-forwarded-proto"] as string | undefined) ?? "";
  const proto = forwarded.split(",")[0].trim().toLowerCase();
  if (proto) return proto === "http";
  return config.nodeEnv === "production";
}

export const authController = {
  async register(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const requireHttps = await settingsService.getValue("security", "jwt_require_https");
      if (requireHttps === true && isCleartextRequest(req)) {
        return error(res, "HTTPS connection required for registration", 403, {
          code: "HTTPS_REQUIRED",
        });
      }
      // Open registration is disabled by default. An admin must explicitly
      // toggle the allow_registration security setting to permit new sign-ups.
      const allowRegistration = await settingsService.getValue("security", "allow_registration");
      if (allowRegistration !== true) {
        return error(res, "Registration is disabled. Contact your administrator.", 403, {
          code: "REGISTRATION_DISABLED",
        });
      }
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
      const requireHttps = await settingsService.getValue("security", "jwt_require_https");
      if (requireHttps === true && isCleartextRequest(req)) {
        return error(res, "HTTPS connection required for login", 403, {
          code: "HTTPS_REQUIRED",
        });
      }
      const result = await authService.login(req.body, getClientInfo(req));
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
          err.message === "Account disabled. Contact your administrator" ||
          err.message === "Invalid MFA code" ||
          err.message === "Invalid recovery code")
      ) {
        return error(res, err.message, 401);
      }
      if (
        err instanceof Error &&
        err.message === "Account temporarily locked. Try again later."
      ) {
        return error(res, err.message, 403);
      }
      if (err instanceof Error && err.message === "MFA code required") {
        return error(res, err.message, 401, { code: "MFA_REQUIRED" });
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

  async issueRealtimeTicket(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = authService.issueRealtimeTicket(
      req.userId!,
      req.userRole || "viewer",
      req.organizationId,
    );
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async mfaSetup(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.mfaSetup(req.userId!);
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async mfaVerify(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.mfaVerify(req.userId!, req.body.code as string);
      const info = getClientInfo(req);
      const user = await authService.me(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: user?.name || "",
        email: user?.email || "",
        action: "mfa_enabled",
        module: "auth",
        description: `MFA enabled for ${user?.email || req.userId}`,
        ...info,
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async mfaDisable(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.mfaDisable(req.userId!, req.body.password as string);
      const info = getClientInfo(req);
      const user = await authService.me(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: user?.name || "",
        email: user?.email || "",
        action: "mfa_disabled",
        module: "auth",
        description: `MFA disabled for ${user?.email || req.userId}`,
        ...info,
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async logout(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const info = getClientInfo(req);
      const user = await authService.me(req.userId!);
      // Server-side logout: bump tokenVersion so the user's outstanding JWT
      // is immediately rejected on every subsequent request.
      await authService.logout(req.userId!);
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
