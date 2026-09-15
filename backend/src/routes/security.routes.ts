import { Router } from "express";
import { securityController } from "../controllers/security.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";

const router = Router();

router.use(authenticate);

router.get("/dashboard", requirePermission("security.read"), securityController.getDashboard);

export default router;