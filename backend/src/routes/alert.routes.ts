import { Router } from "express";
import { alertController } from "@/controllers/alert.controller";
import { authenticate } from "@/middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/", alertController.getAll);
router.get("/unread-count", alertController.getUnreadCount);
router.patch("/:id/read", alertController.markAsRead);
router.patch("/read-all", alertController.markAllAsRead);
router.delete("/:id", alertController.deleteAlert);

export default router;
