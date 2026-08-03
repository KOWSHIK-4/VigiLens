import { Router } from "express";
import { alertController } from "@/controllers/alert.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("alerts.read"), alertController.getAll);
router.get("/unread-count", requirePermission("alerts.read"), alertController.getUnreadCount);
router.patch("/:id/read", requirePermission("alerts.manage"), alertController.markAsRead);
router.patch("/read-all", requirePermission("alerts.manage"), alertController.markAllAsRead);
router.delete("/:id", requirePermission("alerts.manage"), alertController.deleteAlert);

export default router;
