import { Router } from "express";
import { alertController } from "@/controllers/alert.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import { alertIdSchema, alertQuerySchema } from "@/types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("alerts.read"), validate(alertQuerySchema, "query"), alertController.getAll);
router.get("/unread-count", requirePermission("alerts.read"), alertController.getUnreadCount);
router.patch("/read-all", requirePermission("alerts.manage"), alertController.markAllAsRead);
router.patch("/:id/read", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), alertController.markAsRead);
router.delete("/:id", requirePermission("alerts.manage"), validate(alertIdSchema, "params"), alertController.deleteAlert);

export default router;
