import type { Response, NextFunction } from "express";
import type { AuthRequest, SettingsCategory } from "../types";
import { settingsService } from "../services/settings.service";
import { rateLimitService } from "../services/rateLimit.service";
import { userService } from "../services/user.service";
import { success } from "../utils/apiResponse";
import { logAudit } from "../utils/auditLog";

function getClientInfo(req: AuthRequest) {
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "",
    userAgent: req.headers["user-agent"] || "",
  };
}

/**
 * Security settings (password policy, session age, rate limits, MFA) govern
 * the whole instance and are consulted during pre-login / auth flows where no
 * organization context exists. They are deliberately instance-scoped (""),
 * whereas operational settings -- including the webhook configuration under
 * "notifications" -- are scoped to the caller's organization.
 */
function settingsScope(req: AuthRequest, category: SettingsCategory): string {
  return category === "security" ? "" : req.organizationId ?? "";
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
  async getAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const settings = await settingsService.getAll(settingsScope(req, "general"));
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },

  async getByCategory(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = req.params.category as SettingsCategory;
      const settings = await settingsService.getByCategory(category, settingsScope(req, category));
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = req.params.category as SettingsCategory;
      const body = req.body as Record<string, string | number | boolean>;
      const settings = await settingsService.update(category, body, req.userId, settingsScope(req, category));
      await auditSettingsChange(
        req,
        `Settings updated: ${category} (${Object.keys(body).length} value(s))`,
        { category, keys: Object.keys(body) },
      );
      if (category === "security") {
        await rateLimitService.refresh();
      }
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },

  async reset(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const category = req.params.category as SettingsCategory;
      const settings = await settingsService.reset(category, req.userId, settingsScope(req, category));
      await auditSettingsChange(
        req,
        `Settings reset to defaults: ${category}`,
        { category, reset: true },
      );
      if (category === "security") {
        await rateLimitService.refresh();
      }
      success(res, settings);
    } catch (err) {
      next(err);
    }
  },
};
