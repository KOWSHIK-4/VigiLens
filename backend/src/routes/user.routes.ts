import { Router } from "express";
import { userController } from "@/controllers/user.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import {
  assignRoleSchema,
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  userQuerySchema,
  userStatusUpdateSchema,
} from "@/types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission("users.read"),
  validate(userQuerySchema, "query"),
  userController.getAll,
);
router.get(
  "/stats",
  requirePermission("users.read"),
  userController.getStats,
);
router.get(
  "/:id",
  requirePermission("users.read"),
  validate(userIdSchema, "params"),
  userController.getById,
);
router.post(
  "/",
  requirePermission("users.create"),
  validate(createUserSchema),
  userController.create,
);
router.patch(
  "/:id",
  requirePermission("users.update"),
  validate(userIdSchema, "params"),
  validate(updateUserSchema),
  userController.update,
);
router.patch(
  "/:id/role",
  requirePermission("users.assign_role"),
  validate(userIdSchema, "params"),
  validate(assignRoleSchema),
  userController.assignRole,
);
router.patch(
  "/:id/status",
  requirePermission("users.toggle_status"),
  validate(userIdSchema, "params"),
  validate(userStatusUpdateSchema),
  userController.setStatus,
);
router.delete(
  "/:id",
  requirePermission("users.delete"),
  validate(userIdSchema, "params"),
  userController.remove,
);

export default router;
