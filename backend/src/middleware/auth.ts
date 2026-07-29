import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "@/config";
import type { AuthRequest } from "@/types";
import { error as apiError } from "@/utils/apiResponse";

interface JwtPayload {
  userId: string;
  role: string;
}

export function authenticate(
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
