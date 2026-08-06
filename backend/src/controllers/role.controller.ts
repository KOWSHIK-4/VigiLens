import type { Response, NextFunction } from "express";
import type { AuthRequest, CreateRoleInput, UpdateRoleInput } from "@/types";
import { roleService } from "@/services/role.service";
import { permissionService } from "@/services/permission.service";
import { userService } from "@/services/user.service";
import { success } from "@/utils/apiResponse";
import { logAudit } from "@/utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

export const roleController = {
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const roles = await roleService.findAll();
      success(res, roles);
    } catch (err) {
      next(err);
    }
  },

  async getAllPermissions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const permissions = await permissionService.getAllPermissions();
      success(res, permissions);
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const role = await roleService.create(req.body as CreateRoleInput);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "role_created",
        module: "roles",
        description: `Role created: ${role.name}`,
        ...info,
        metadata: {
          role: role.name,
          permissionKeys: (req.body as CreateRoleInput).permissionKeys ?? [],
        },
      });
      success(res, role, 201);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const role = await roleService.update(
        req.params.name as string,
        req.body as UpdateRoleInput,
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "role_updated",
        module: "roles",
        description: `Role updated: ${role.name}`,
        ...info,
        metadata: { role: role.name, fields: Object.keys(req.body) },
      });
      success(res, role);
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const result = await roleService.remove(req.params.name as string);
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "role_deleted",
        module: "roles",
        description: `Role deleted: ${req.params.name}`,
        ...info,
        metadata: { role: req.params.name },
      });
      success(res, result);
    } catch (err) {
      next(err);
    }
  },

  async updatePermissions(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const role = await roleService.updatePermissions(
        req.params.name as string,
        (req.body as UpdateRoleInput).permissionKeys ?? [],
      );
      const info = getClientInfo(req);
      const actor = await userService.findById(req.userId!).catch(() => null);
      await logAudit({
        userId: req.userId,
        username: actor?.name || "",
        email: actor?.email || "",
        action: "role_updated",
        module: "roles",
        description: `Permissions updated for role: ${role.name}`,
        ...info,
        metadata: {
          role: role.name,
          permissionKeys: (req.body as UpdateRoleInput).permissionKeys ?? [],
        },
      });
      success(res, role);
    } catch (err) {
      next(err);
    }
  },
};
