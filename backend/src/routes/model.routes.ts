import { Router } from "express";
import { modelController } from "@/controllers/model.controller";
import { authenticate } from "@/middleware/auth";
import { requirePermission } from "@/middleware/permissions";
import { validate } from "@/middleware/validate";
import {
  createModelSchema,
  modelIdSchema,
  modelQuerySchema,
  modelThresholdSchema,
  updateModelSchema,
} from "@/types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("models.read"), validate(modelQuerySchema, "query"), modelController.getAll);
router.get("/active", requirePermission("models.read"), modelController.getActive);
router.post("/", requirePermission("models.manage"), validate(createModelSchema), modelController.create);
router.get("/:id", requirePermission("models.read"), validate(modelIdSchema, "params"), modelController.getById);
router.patch("/:id", requirePermission("models.manage"), validate(modelIdSchema, "params"), validate(updateModelSchema), modelController.update);
router.patch("/:id/enable", requirePermission("models.manage"), validate(modelIdSchema, "params"), modelController.enable);
router.patch("/:id/disable", requirePermission("models.manage"), validate(modelIdSchema, "params"), modelController.disable);
router.patch("/:id/threshold", requirePermission("models.manage"), validate(modelIdSchema, "params"), validate(modelThresholdSchema), modelController.updateThreshold);
router.delete("/:id", requirePermission("models.manage"), validate(modelIdSchema, "params"), modelController.remove);
router.post("/:id/load", requirePermission("models.manage"), validate(modelIdSchema, "params"), modelController.load);
router.post("/:id/unload", requirePermission("models.manage"), validate(modelIdSchema, "params"), modelController.unload);
router.post("/:id/test", requirePermission("models.manage"), validate(modelIdSchema, "params"), modelController.test);

export default router;
