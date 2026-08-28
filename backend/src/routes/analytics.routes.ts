import { Router } from "express";
import { analyticsController } from "../controllers/analytics.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import { analyticsQuerySchema } from "../types";

const router = Router();

router.use(authenticate);
router.use(requirePermission("analytics.read"));

router.get("/overview", analyticsController.getOverview);
router.get("/daily", validate(analyticsQuerySchema, "query"), analyticsController.getDaily);
router.get("/cameras", validate(analyticsQuerySchema, "query"), analyticsController.getCameras);
router.get("/detectors", validate(analyticsQuerySchema, "query"), analyticsController.getDetectors);
router.get("/timeline", validate(analyticsQuerySchema, "query"), analyticsController.getTimeline);
router.get(
  "/confidence",
  validate(analyticsQuerySchema, "query"),
  analyticsController.getConfidenceDistribution,
);

export default router;
