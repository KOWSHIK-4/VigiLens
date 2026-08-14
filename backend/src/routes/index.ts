import { Router } from "express";
import authRoutes from "./auth.routes";
import detectionRoutes from "./detection.routes";
import cameraRoutes from "./camera.routes";
import alertRoutes from "./alert.routes";
import analyticsRoutes from "./analytics.routes";
import reportRoutes from "./report.routes";
import modelRoutes from "./model.routes";
import detectorRoutes from "./detector.routes";
import engineRoutes from "./engine.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";
import auditLogRoutes from "./auditLog.routes";
import settingsRoutes from "./settings.routes";
import systemRoutes from "./system.routes";
import monitorRoutes from "./monitor.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/detections", detectionRoutes);
router.use("/cameras", cameraRoutes);
router.use("/alerts", alertRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/reports", reportRoutes);
router.use("/models", modelRoutes);
router.use("/detectors", detectorRoutes);
router.use("/engines", engineRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/audit-logs", auditLogRoutes);
router.use("/settings", settingsRoutes);
router.use("/system", systemRoutes);
router.use("/monitor", monitorRoutes);

export default router;
