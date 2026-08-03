import type { Response, NextFunction } from "express";
import type { AuthRequest, UpdateRolePermissionsInput } from "@/types";
import { roleService } from "@/services/role.service";
import { success } from "@/utils/apiResponse";

export const roleController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const roles = await roleService.findAll();
      success(res, roles);
    } catch (err) {
      next(err);
    }
  },

  async updatePermissions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const role = await roleService.updatePermissions(
        req.params.name as "super_admin" | "admin" | "operator" | "viewer",
        (req.body as UpdateRolePermissionsInput).permissionKeys,
      );
      success(res, role);
    } catch (err) {
      next(err);
    }
  },
};
