import { Router } from "express";
import { roleController } from "@/controllers/role.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import { roleNameSchema, updateRolePermissionsSchema } from "@/types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission("roles.read"),
  roleController.getAll,
);
router.patch(
  "/:name/permissions",
  requirePermission("roles.manage"),
  validate(roleNameSchema, "params"),
  validate(updateRolePermissionsSchema),
  roleController.updatePermissions,
);

export default router;
