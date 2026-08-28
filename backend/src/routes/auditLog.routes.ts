import { Router } from "express";
import { auditLogController } from "../controllers/auditLog.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { auditLogExportQuerySchema, auditLogIdSchema, auditLogQuerySchema } from "../types";
import { validate } from "../middleware/validate";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("audit.read"), validate(auditLogQuerySchema, "query"), auditLogController.getAll);
router.get("/stats", requirePermission("audit.read"), auditLogController.getStats);
router.get("/charts", requirePermission("audit.read"), auditLogController.getChartData);
router.get(
  "/export",
  requirePermission("audit.export"),
  validate(auditLogExportQuerySchema, "query"),
  auditLogController.exportCSV,
);
router.get("/:id", requirePermission("audit.read"), validate(auditLogIdSchema, "params"), auditLogController.getById);

export default router;
