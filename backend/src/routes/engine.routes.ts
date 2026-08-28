import { Router } from "express";
import multer from "multer";
import { engineController } from "../controllers/engine.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import { engineKeyParamSchema } from "../types";

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
router.get("/:key", requirePermission("models.read"), validate(engineKeyParamSchema, "params"), engineController.getByKey);
router.get(
  "/:key/metrics",
  requirePermission("models.read"),
  validate(engineKeyParamSchema, "params"),
  engineController.getMetrics,
);
router.get(
  "/:key/health",
  requirePermission("models.read"),
  validate(engineKeyParamSchema, "params"),
  engineController.getHealth,
);
router.get(
  "/:key/detections",
  requirePermission("models.read"),
  validate(engineKeyParamSchema, "params"),
  engineController.getDetections,
);
router.post(
  "/:key/process",
  requirePermission("models.run"),
  validate(engineKeyParamSchema, "params"),
  upload.single("image"),
  engineController.processImage,
);
router.post(
  "/:key/process-live",
  requirePermission("models.run"),
  validate(engineKeyParamSchema, "params"),
  engineController.processLive,
);

export default router;
