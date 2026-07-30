import { Router } from "express";
import { cameraController } from "@/controllers/camera.controller";
import { authenticate, authorize } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { createCameraSchema, updateCameraSchema, cameraQuerySchema } from "@/types";

const router = Router();

router.use(authenticate);

router.get("/", validate(cameraQuerySchema, "query"), cameraController.getAll);
router.get("/:id", cameraController.getById);
router.post("/", authorize("admin", "operator"), validate(createCameraSchema), cameraController.create);
router.patch("/:id", authorize("admin", "operator"), validate(updateCameraSchema), cameraController.update);
router.delete("/:id", authorize("admin"), cameraController.remove);
router.post("/:id/start", authorize("admin", "operator"), cameraController.start);
router.post("/:id/stop", authorize("admin", "operator"), cameraController.stop);
router.post("/:id/health", cameraController.healthCheck);
router.get("/:id/health-logs", cameraController.getHealthLogs);

export default router;
