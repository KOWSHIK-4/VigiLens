import { Router } from "express";
import { detectionController } from "@/controllers/detection.controller";
import { authenticate } from "@/middleware/auth";

const router = Router();

router.post("/internal", detectionController.create);

router.use(authenticate);

router.get("/export/csv", detectionController.exportCSV);
router.get("/stats", detectionController.getStats);
router.get("/", detectionController.getAll);
router.get("/:id", detectionController.getById);

export default router;
