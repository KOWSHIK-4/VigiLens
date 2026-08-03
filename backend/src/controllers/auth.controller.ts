import type { Response, NextFunction } from "express";
import { authService } from "@/services/auth.service";
import { success, error } from "@/utils/apiResponse";
import type { AuthRequest } from "@/types";
import { logger } from "@/config/logger";

export const authController = {
  async register(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.register(req.body);
      logger.info(`User registered: ${result.user.email}`);
      success(res, result, 201);
    } catch (err) {
      if (err instanceof Error && err.message === "Email already in use") {
        return error(res, err.message, 409);
      }
      next(err);
    }
  },

  async login(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(req.body);
      logger.info(`User logged in: ${result.user.email}`);
      success(res, result);
    } catch (err) {
      if (
        err instanceof Error &&
        (err.message === "Invalid email or password" ||
          err.message === "Account disabled. Contact your administrator")
      ) {
        return error(res, err.message, 401);
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
};
