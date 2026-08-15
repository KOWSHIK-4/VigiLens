import { Router } from "express";
import { cameraController } from "@/controllers/camera.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import { createCameraSchema, updateCameraSchema, cameraQuerySchema } from "@/types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("cameras.read"), validate(cameraQuerySchema, "query"), cameraController.getAll);
router.get("/:id", requirePermission("cameras.read"), cameraController.getById);
router.post("/", requirePermission("cameras.manage"), validate(createCameraSchema), cameraController.create);
router.patch("/:id", requirePermission("cameras.manage"), validate(updateCameraSchema), cameraController.update);
router.delete("/:id", requirePermission("cameras.manage"), cameraController.remove);
router.post("/:id/start", requirePermission("cameras.control"), cameraController.start);
router.post("/:id/stop", requirePermission("cameras.control"), cameraController.stop);
router.post("/:id/capture", requirePermission("cameras.control"), cameraController.capture);
router.get("/:id/thumbnail", requirePermission("cameras.read"), cameraController.getThumbnail);
router.post("/:id/health", requirePermission("cameras.read"), cameraController.healthCheck);
router.get("/:id/health-logs", requirePermission("cameras.read"), cameraController.getHealthLogs);

export default router;
