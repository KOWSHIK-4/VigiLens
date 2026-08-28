import { Router } from "express";
import { monitorController } from "../controllers/monitor.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("monitoring.read"), monitorController.getStatus);
router.post("/start", requirePermission("monitoring.manage"), monitorController.start);
router.post("/stop", requirePermission("monitoring.manage"), monitorController.stop);

export default router;
