import { Router } from "express";
import { detectorController } from "../controllers/detector.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import {
  requireInstanceAdmin,
  INSTANCE_DETECTOR_MESSAGE,
} from "../middleware/instanceScope";
import { validate } from "../middleware/validate";
import {
  detectorQuerySchema,
  detectorIdSchema,
  installDetectorSchema,
  updateDetectorSchema,
  detectorSettingsSchema,
  detectorCamerasSchema,
} from "../types";

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
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(installDetectorSchema),
  detectorController.install,
);
router.get(
  "/:id",
  requirePermission("models.read"),
  validate(detectorIdSchema, "params"),
  detectorController.getById,
);
router.patch(
  "/:id",
  requirePermission("models.manage"),
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(detectorIdSchema, "params"),
  validate(updateDetectorSchema),
  detectorController.update,
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
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(detectorIdSchema, "params"),
  detectorController.restart,
);
router.delete(
  "/:id",
  requirePermission("models.manage"),
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(detectorIdSchema, "params"),
  detectorController.uninstall,
);
router.patch(
  "/:id/enable",
  requirePermission("models.manage"),
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(detectorIdSchema, "params"),
  detectorController.enable,
);
router.patch(
  "/:id/disable",
  requirePermission("models.manage"),
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(detectorIdSchema, "params"),
  detectorController.disable,
);
router.patch(
  "/:id/settings",
  requirePermission("models.manage"),
  requireInstanceAdmin(INSTANCE_DETECTOR_MESSAGE),
  validate(detectorIdSchema, "params"),
  validate(detectorSettingsSchema),
  detectorController.updateSettings,
);
// Camera assignment stays open to tenant admins: assignCameras already scopes
// its writes to the caller's own organization, so pointing a shared detector at
// your own cameras cannot affect another tenant's assignments.
router.put(
  "/:id/cameras",
  requirePermission("models.manage"),
  validate(detectorIdSchema, "params"),
  validate(detectorCamerasSchema),
  detectorController.assignCameras,
);

export default router;
