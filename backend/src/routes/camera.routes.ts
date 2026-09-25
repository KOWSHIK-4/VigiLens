import { Router } from "express";
import { cameraController } from "../controllers/camera.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { enforceTeamVisibility } from "../middleware/teamVisibility";
import { validate } from "../middleware/validate";
import {
  cameraIdSchema,
  cameraQuerySchema,
  createCameraSchema,
  updateCameraSchema,
  assignCameraTeamSchema,
} from "../types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("cameras.read"), validate(cameraQuerySchema, "query"), enforceTeamVisibility, cameraController.getAll);
router.get(
  "/fleet/health",
  requirePermission("monitoring.read"),
  enforceTeamVisibility,
  cameraController.getFleetHealth,
);
router.get("/:id", requirePermission("cameras.read"), enforceTeamVisibility, validate(cameraIdSchema, "params"), cameraController.getById);
router.post("/", requirePermission("cameras.manage"), validate(createCameraSchema), cameraController.create);
router.patch(
  "/:id",
  requirePermission("cameras.manage"),
  enforceTeamVisibility,
  validate(cameraIdSchema, "params"),
  validate(updateCameraSchema),
  cameraController.update,
);
router.delete("/:id", requirePermission("cameras.manage"), enforceTeamVisibility, validate(cameraIdSchema, "params"), cameraController.remove);
router.post("/:id/start", requirePermission("cameras.control"), enforceTeamVisibility, validate(cameraIdSchema, "params"), cameraController.start);
router.post("/:id/stop", requirePermission("cameras.control"), enforceTeamVisibility, validate(cameraIdSchema, "params"), cameraController.stop);
router.patch("/:id/team", requirePermission("cameras.manage"), enforceTeamVisibility, validate(cameraIdSchema, "params"), validate(assignCameraTeamSchema), cameraController.assignTeam);
router.post("/:id/capture", requirePermission("cameras.control"), enforceTeamVisibility, validate(cameraIdSchema, "params"), cameraController.capture);
router.get(
  "/:id/thumbnail",
  requirePermission("cameras.read"),
  enforceTeamVisibility,
  validate(cameraIdSchema, "params"),
  cameraController.getThumbnail,
);
router.post(
  "/:id/health",
  requirePermission("cameras.read"),
  enforceTeamVisibility,
  validate(cameraIdSchema, "params"),
  cameraController.healthCheck,
);
router.get(
  "/:id/health-logs",
  requirePermission("cameras.read"),
  enforceTeamVisibility,
  validate(cameraIdSchema, "params"),
  cameraController.getHealthLogs,
);

export default router;
