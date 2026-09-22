import { Router } from "express";
import { alertController } from "../controllers/alert.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import { alertIdSchema, alertQuerySchema, assignAlertTeamSchema, escalateAlertSchema } from "../types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("alerts.read"), validate(alertQuerySchema, "query"), alertController.getAll);
router.get("/export", requirePermission("alerts.read"), validate(alertQuerySchema, "query"), alertController.exportCsv);
router.get("/unread-count", requirePermission("alerts.read"), alertController.getUnreadCount);
router.patch("/read-all", requirePermission("alerts.manage"), alertController.markAllAsRead);
router.patch("/:id/read", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), alertController.markAsRead);
router.patch("/:id/acknowledge", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), alertController.acknowledge);
router.patch("/:id/escalate", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), validate(escalateAlertSchema, "body"), alertController.escalate);
router.patch("/:id/team", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), validate(assignAlertTeamSchema, "body"), alertController.assignTeam);
router.delete("/:id", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), alertController.deleteAlert);

export default router;
