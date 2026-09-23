import { Router } from "express";
import { detectionController } from "../controllers/detection.controller";
import { authenticate } from "../middleware/auth";
import { requireInternalKey } from "../middleware/internal";
import { requirePermission } from "../middleware/permissions";
import { enforceTeamVisibility } from "../middleware/teamVisibility";
import { validate } from "../middleware/validate";
import { detectionIdSchema, detectionQuerySchema } from "../types";

const router = Router();

router.post("/internal", requireInternalKey, detectionController.create);

router.use(authenticate);

router.get(
  "/fleet/correlation",
  requirePermission("detections.read"),
  detectionController.getFleetCorrelation,
);
router.get(
  "/export/csv",
  requirePermission("detections.read"),
  validate(detectionQuerySchema, "query"),
  enforceTeamVisibility,
  detectionController.exportCSV,
);
router.get("/stats", requirePermission("detections.read"), enforceTeamVisibility, detectionController.getStats);
router.get(
  "/",
  requirePermission("detections.read"),
  validate(detectionQuerySchema, "query"),
  enforceTeamVisibility,
  detectionController.getAll,
);
router.get(
  "/:id/risk",
  requirePermission("detections.read"),
  validate(detectionIdSchema, "params"),
  detectionController.getRiskScore,
);
router.get(
  "/:id",
  requirePermission("detections.read"),
  validate(detectionIdSchema, "params"),
  detectionController.getById,
);
router.delete(
  "/:id",
  requirePermission("detections.manage"),
  validate(detectionIdSchema, "params"),
  detectionController.remove,
);

export default router;
