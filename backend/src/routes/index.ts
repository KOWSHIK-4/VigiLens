import { Router } from "express";
import authRoutes from "./auth.routes";
import detectionRoutes from "./detection.routes";
import cameraRoutes from "./camera.routes";
import alertRoutes from "./alert.routes";
import analyticsRoutes from "./analytics.routes";
import reportRoutes from "./report.routes";
import modelRoutes from "./model.routes";
import userRoutes from "./user.routes";
import roleRoutes from "./role.routes";
import auditLogRoutes from "./auditLog.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/detections", detectionRoutes);
router.use("/cameras", cameraRoutes);
router.use("/alerts", alertRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/reports", reportRoutes);
router.use("/models", modelRoutes);
router.use("/users", userRoutes);
router.use("/roles", roleRoutes);
router.use("/audit-logs", auditLogRoutes);

export default router;
