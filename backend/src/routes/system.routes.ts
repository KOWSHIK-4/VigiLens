import { Router } from "express";
import { systemController } from "../controllers/system.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";

const router = Router();

router.use(authenticate);
router.use(requirePermission("monitoring.read"));

router.get("/health", systemController.getHealth);
router.get("/monitoring", systemController.getMonitoring);
router.get("/metrics", systemController.getMetrics);

export default router;
