import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "@/config";
import { prisma } from "@/config/prisma";
import type { AuthRequest } from "@/types";
import { error as apiError } from "@/utils/apiResponse";
import { permissionService } from "@/services/permission.service";

interface JwtPayload {
  userId: string;
  role: string;
}

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return apiError(res, "Authentication required", 401);
  }

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    req.userId = decoded.userId;
    req.userRole = decoded.role;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, status: true, role: true },
    });

    if (!user) {
      return apiError(res, "User no longer exists", 401);
    }
    if (user.status === "disabled") {
      return apiError(res, "Account disabled. Contact your administrator", 403);
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
