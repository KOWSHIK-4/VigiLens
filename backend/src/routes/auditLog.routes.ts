import { Router } from "express";
import { auditLogController } from "@/controllers/auditLog.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { auditLogQuerySchema } from "@/types";
import { validate } from "@/middleware/validate";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("audit.read"), validate(auditLogQuerySchema, "query"), auditLogController.getAll);
router.get("/stats", requirePermission("audit.read"), auditLogController.getStats);
router.get("/charts", requirePermission("audit.read"), auditLogController.getChartData);
router.get("/export", requirePermission("audit.export"), auditLogController.exportCSV);
router.get("/:id", requirePermission("audit.read"), auditLogController.getById);

export default router;
