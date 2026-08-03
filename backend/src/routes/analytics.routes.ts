import { Router } from "express";
import { analyticsController } from "@/controllers/analytics.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";

const router = Router();

router.use(authenticate);
router.use(requirePermission("analytics.read"));

router.get("/overview", analyticsController.getOverview);
router.get("/daily", analyticsController.getDaily);
router.get("/cameras", analyticsController.getCameras);
router.get("/detectors", analyticsController.getDetectors);
router.get("/timeline", analyticsController.getTimeline);
router.get("/confidence", analyticsController.getConfidenceDistribution);

export default router;
