import { Router } from "express";
import { settingsController } from "../controllers/settings.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import { settingsCategoryParamSchema, updateSettingsSchema } from "../types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("settings.read"), settingsController.getAll);

router.get(
  "/:category",
  requirePermission("settings.read"),
  validate(settingsCategoryParamSchema, "params"),
  settingsController.getByCategory,
);

router.patch(
  "/:category",
  requirePermission("settings.manage"),
  validate(settingsCategoryParamSchema, "params"),
  validate(updateSettingsSchema),
  settingsController.update,
);

router.post(
  "/:category/reset",
  requirePermission("settings.manage"),
  validate(settingsCategoryParamSchema, "params"),
  settingsController.reset,
);

export default router;
