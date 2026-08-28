import type { Response, NextFunction } from "express";
import type { AuthRequest, SettingsCategory } from "../types";
import { settingsService } from "../services/settings.service";
import { userService } from "../services/user.service";
import { success } from "../utils/apiResponse";
import { logAudit } from "../utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

async function auditSettingsChange(
  req: AuthRequest,
  description: string,
  metadata: Record<string, unknown>,
) {
  const info = getClientInfo(req);
  const actor = await userService.findById(req.userId!).catch(() => null);
  await logAudit({
    userId: req.userId,
    username: actor?.name || "",
    email: actor?.email || "",
    action: "settings_changed",
    module: "settings",
    description,
    ...info,
    metadata,
  });
}

export const settingsController = {
  async getAll(_req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.getAll();
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },

  async getByCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = req.params.category as SettingsCategory;
      const settings = await settingsService.getByCategory(category);
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = req.params.category as SettingsCategory;
      const body = req.body as Record<string, string | number | boolean>;
      const settings = await settingsService.update(category, body, req.userId);
      await auditSettingsChange(
        req,
        `Settings updated: ${category} (${Object.keys(body).length} value(s))`,
        { category, keys: Object.keys(body) },
      );
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },

  async reset(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = req.params.category as SettingsCategory;
      const settings = await settingsService.reset(category, req.userId);
      await auditSettingsChange(
        req,
        `Settings reset to defaults: ${category}`,
        { category, reset: true },
      );
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },
};
