import { Router } from "express";
import { detectionController } from "@/controllers/detection.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";

const router = Router();

router.post("/internal", detectionController.create);

router.use(authenticate);

router.get("/export/csv", requirePermission("detections.read"), detectionController.exportCSV);
router.get("/stats", requirePermission("detections.read"), detectionController.getStats);
router.get("/", requirePermission("detections.read"), detectionController.getAll);
router.get("/:id", requirePermission("detections.read"), detectionController.getById);
router.delete("/:id", requirePermission("detections.manage"), detectionController.remove);

export default router;
