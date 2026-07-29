import { Router } from "express";
import { cameraController } from "@/controllers/camera.controller";
import { authenticate } from "@/middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/", cameraController.getAll);
router.get("/:id", cameraController.getById);

export default router;
