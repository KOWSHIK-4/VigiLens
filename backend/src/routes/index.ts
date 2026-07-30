import { Router } from "express";
import authRoutes from "./auth.routes";
import detectionRoutes from "./detection.routes";
import cameraRoutes from "./camera.routes";
import alertRoutes from "./alert.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/detections", detectionRoutes);
router.use("/cameras", cameraRoutes);
router.use("/alerts", alertRoutes);

export default router;
