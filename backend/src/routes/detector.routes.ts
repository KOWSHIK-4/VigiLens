import { Router } from "express";
import { detectorController } from "@/controllers/detector.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import {
  detectorQuerySchema,
  detectorIdSchema,
  installDetectorSchema,
  detectorSettingsSchema,
  detectorCamerasSchema,
} from "@/types";

const router = Router();

router.use(authenticate);

router.get(
  "/marketplace",
  requirePermission("models.read"),
  detectorController.getMarketplace,
);
router.get(
  "/categories",
  requirePermission("models.read"),
  detectorController.getCategories,
);
router.get(
  "/",
  requirePermission("models.read"),
  validate(detectorQuerySchema, "query"),
  detectorController.getAll,
);
router.post(
  "/",
  requirePermission("models.manage"),
  validate(installDetectorSchema),
  detectorController.install,
);
router.get(
  "/:id",
  requirePermission("models.read"),
  validate(detectorIdSchema, "params"),
  detectorController.getById,
);
router.get(
  "/:id/health",
  requirePermission("models.read"),
  validate(detectorIdSchema, "params"),
  detectorController.health,
);
router.post(
  "/:id/restart",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  detectorController.restart,
);
router.delete(
  "/:id",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  detectorController.uninstall,
);
router.patch(
  "/:id/enable",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  detectorController.enable,
);
router.patch(
  "/:id/disable",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  detectorController.disable,
);
router.patch(
  "/:id/settings",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  validate(detectorSettingsSchema),
  detectorController.updateSettings,
);
router.put(
  "/:id/cameras",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  validate(detectorCamerasSchema),
  detectorController.assignCameras,
);

export default router;
