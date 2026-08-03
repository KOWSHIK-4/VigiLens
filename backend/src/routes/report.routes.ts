import { Router } from "express";
import { reportController } from "@/controllers/report.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import { generateReportSchema, reportQuerySchema } from "@/types";

const router = Router();

router.use(authenticate);
router.use(requirePermission("reports.read"));

router.post("/generate", validate(generateReportSchema), reportController.generate);
router.get("/", validate(reportQuerySchema, "query"), reportController.getAll);
router.get("/download/:id", reportController.download);
router.get("/:id", reportController.getById);
router.delete("/:id", reportController.remove);

export default router;
