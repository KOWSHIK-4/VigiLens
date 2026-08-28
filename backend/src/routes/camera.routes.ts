import { Router } from "express";
import { cameraController } from "../controllers/camera.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import {
  cameraIdSchema,
  cameraQuerySchema,
  createCameraSchema,
  updateCameraSchema,
} from "../types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("cameras.read"), validate(cameraQuerySchema, "query"), cameraController.getAll);
router.get("/:id", requirePermission("cameras.read"), validate(cameraIdSchema, "params"), cameraController.getById);
router.post("/", requirePermission("cameras.manage"), validate(createCameraSchema), cameraController.create);
router.patch(
  "/:id",
  requirePermission("cameras.manage"),
  validate(cameraIdSchema, "params"),
  validate(updateCameraSchema),
  cameraController.update,
);
router.delete("/:id", requirePermission("cameras.manage"), validate(cameraIdSchema, "params"), cameraController.remove);
router.post("/:id/start", requirePermission("cameras.control"), validate(cameraIdSchema, "params"), cameraController.start);
router.post("/:id/stop", requirePermission("cameras.control"), validate(cameraIdSchema, "params"), cameraController.stop);
router.post("/:id/capture", requirePermission("cameras.control"), validate(cameraIdSchema, "params"), cameraController.capture);
router.get(
  "/:id/thumbnail",
  requirePermission("cameras.read"),
  validate(cameraIdSchema, "params"),
  cameraController.getThumbnail,
);
router.post(
  "/:id/health",
  requirePermission("cameras.read"),
  validate(cameraIdSchema, "params"),
  cameraController.healthCheck,
);
router.get(
  "/:id/health-logs",
  requirePermission("cameras.read"),
  validate(cameraIdSchema, "params"),
  cameraController.getHealthLogs,
);

export default router;
