import { Router } from "express";
import multer from "multer";
import { engineController } from "@/controllers/engine.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image uploads are allowed"));
  },
});

router.use(authenticate);

router.get("/", requirePermission("models.read"), engineController.listAll);
router.get("/:key", requirePermission("models.read"), engineController.getByKey);
router.get("/:key/metrics", requirePermission("models.read"), engineController.getMetrics);
router.get("/:key/health", requirePermission("models.read"), engineController.getHealth);
router.get("/:key/detections", requirePermission("models.read"), engineController.getDetections);
router.post(
  "/:key/process",
  requirePermission("models.manage"),
  upload.single("image"),
  engineController.processImage,
);
router.post(
  "/:key/process-live",
  requirePermission("models.manage"),
  engineController.processLive,
);

export default router;
