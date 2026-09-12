import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../config/prisma";
import type { AuthRequest } from "../types";
import { error as apiError } from "../utils/apiResponse";
import { permissionService } from "../services/permission.service";

interface JwtPayload {
  userId: string;
  role: string;
}

const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = new Set([
  "/change-password",
  "/me",
  "/logout",
]);

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  // EventSource cannot set the Authorization header, so the realtime stream
  // endpoint (`/api/realtime/events`) authenticates with a short-lived
  // ?token= query parameter instead. The fallback is intentionally limited
  // to that single route so JWTs never travel in URLs elsewhere.
  const isRealtimeStream =
    req.originalUrl?.split("?")[0] === "/api/realtime/events";
  const queryToken =
    isRealtimeStream && typeof req.query.token === "string" && req.query.token.length > 0
      ? req.query.token
      : undefined;

  if (!header?.startsWith("Bearer ") && !queryToken) {
    return apiError(res, "Authentication required", 401);
  }

  try {
    const token = queryToken ?? header!.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.userId = decoded.userId;
    req.userRole = decoded.role;

    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        role: true,
        isLocked: true,
        mustChangePassword: true,
      },
    });

    if (!user) {
      return apiError(res, "User no longer exists", 401);
    }
    if (user.status === "disabled") {
      return apiError(res, "Account disabled. Contact your administrator", 403);
    }
    if (user.isLocked) {
      return apiError(res, "Account locked. Contact your administrator", 403);
    }
    if (
      user.mustChangePassword &&
      !ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.has(req.path)
    ) {
      return apiError(res, "Password change required", 403, {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    req.userRole = user.role;
    req.permissions = await permissionService.getPermissionsForRole(user.role);
    next();
  } catch {
    return apiError(res, "Invalid or expired token", 401);
  }
}

export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return apiError(res, "Insufficient permissions", 403);
    }
    next();
  };
}
