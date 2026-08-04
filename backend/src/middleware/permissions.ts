import type { Response, NextFunction } from "express";
import type { AuthRequest } from "@/types";
import { error as apiError } from "@/utils/apiResponse";

export function requirePermission(...keys: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.permissions) {
      return apiError(res, "Authentication required", 401);
    }
    const allowed = keys.some((key) => req.permissions!.has(key));
    if (!allowed) {
      return apiError(res, "Insufficient permissions", 403);
    }
    next();
  };
}
