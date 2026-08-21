import { Router } from "express";
import { reportController } from "@/controllers/report.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import {
  generateReportSchema,
  reportDownloadQuerySchema,
  reportIdSchema,
  reportQuerySchema,
} from "@/types";

const router = Router();

router.use(authenticate);
router.use(requirePermission("reports.read"));

router.post(
  "/generate",
  requirePermission("reports.manage"),
  validate(generateReportSchema),
  reportController.generate,
);
router.get("/", validate(reportQuerySchema, "query"), reportController.getAll);
router.get(
  "/download/:id",
  validate(reportIdSchema, "params"),
  validate(reportDownloadQuerySchema, "query"),
  reportController.download,
);
router.get("/:id", validate(reportIdSchema, "params"), reportController.getById);
router.delete(
  "/:id",
  requirePermission("reports.manage"),
  validate(reportIdSchema, "params"),
  reportController.remove,
);

export default router;
