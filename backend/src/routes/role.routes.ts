import { Router } from "express";
import { roleController } from "@/controllers/role.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import {
  createRoleSchema,
  roleNameSchema,
  updateRolePermissionsSchema,
  updateRoleSchema,
} from "@/types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission("roles.read"),
  roleController.getAll,
);
router.get(
  "/permissions",
  requirePermission("roles.read"),
  roleController.getAllPermissions,
);
router.post(
  "/",
  requirePermission("roles.manage"),
  validate(createRoleSchema),
  roleController.create,
);
router.patch(
  "/:name",
  requirePermission("roles.manage"),
  validate(roleNameSchema, "params"),
  validate(updateRoleSchema),
  roleController.update,
);
router.patch(
  "/:name/permissions",
  requirePermission("roles.manage"),
  validate(roleNameSchema, "params"),
  validate(updateRolePermissionsSchema),
  roleController.updatePermissions,
);
router.delete(
  "/:name",
  requirePermission("roles.manage"),
  validate(roleNameSchema, "params"),
  roleController.remove,
);

export default router;
