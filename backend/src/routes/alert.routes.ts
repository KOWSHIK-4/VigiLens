import { Router } from "express";
import { alertController } from "../controllers/alert.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { enforceTeamVisibility } from "../middleware/teamVisibility";
import { validate } from "../middleware/validate";
import { alertIdSchema, alertQuerySchema, assignAlertTeamSchema, escalateAlertSchema } from "../types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("alerts.read"), validate(alertQuerySchema, "query"), enforceTeamVisibility, alertController.getAll);
router.get("/export", requirePermission("alerts.read"), validate(alertQuerySchema, "query"), enforceTeamVisibility, alertController.exportCsv);
router.get("/unread-count", requirePermission("alerts.read"), enforceTeamVisibility, alertController.getUnreadCount);
router.patch("/read-all", requirePermission("alerts.manage"), enforceTeamVisibility, alertController.markAllAsRead);
router.patch("/:id/read", requirePermission("alerts.manage"), enforceTeamVisibility, validate(alertIdSchema, "params"), alertController.markAsRead);
router.patch("/:id/acknowledge", requirePermission("alerts.manage"), enforceTeamVisibility, validate(alertIdSchema, "params"), alertController.acknowledge);
router.patch("/:id/escalate", requirePermission("alerts.manage"), enforceTeamVisibility, validate(alertIdSchema, "params"), validate(escalateAlertSchema, "body"), alertController.escalate);
router.patch("/:id/team", requirePermission("alerts.manage"), enforceTeamVisibility, validate(alertIdSchema, "params"), validate(assignAlertTeamSchema, "body"), alertController.assignTeam);
router.delete("/:id", requirePermission("alerts.manage"), enforceTeamVisibility, validate(alertIdSchema, "params"), alertController.deleteAlert);

export default router;
