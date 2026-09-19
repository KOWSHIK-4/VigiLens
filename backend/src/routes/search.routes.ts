import { Router } from "express";
import { searchController } from "../controllers/search.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import { searchQuerySchema } from "../types";

const router = Router();

router.use(authenticate);

// Global search across first-class read surfaces. Gated on the highest-tier
// read permission so it stays an admin/analyst capability; the service trims
// sections to the caller's own grants so users without `users.read`, etc.
// never see those rows.
router.get(
  "/",
  requirePermission("monitoring.read"),
  validate(searchQuerySchema, "query"),
  searchController.globalSearch,
);

export default router;