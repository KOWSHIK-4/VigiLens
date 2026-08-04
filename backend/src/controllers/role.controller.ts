import type { Response, NextFunction } from "express";
import type { AuthRequest, UpdateRolePermissionsInput } from "@/types";
import { roleService } from "@/services/role.service";
import { userService } from "@/services/user.service";
import { success } from "@/utils/apiResponse";
import { logAudit } from "@/utils/auditLog";

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
      const info = {
        ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      };
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "settings_changed",
        module: "roles",
        description: `Permissions updated for role: ${role.name}`,
        ...info,
        metadata: { role: role.name, permissionKeys: (req.body as UpdateRolePermissionsInput).permissionKeys },
      });
      success(res, role);
    } catch (err) {
      next(err);
    }
  },
};
