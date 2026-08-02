import { Router } from "express";
import { modelController } from "@/controllers/model.controller";
import { authenticate } from "@/middleware/auth";
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

router.get("/", validate(modelQuerySchema, "query"), modelController.getAll);
router.get("/active", modelController.getActive);
router.post("/", validate(createModelSchema), modelController.create);
router.get("/:id", validate(modelIdSchema, "params"), modelController.getById);
router.patch("/:id", validate(modelIdSchema, "params"), validate(updateModelSchema), modelController.update);
router.patch("/:id/enable", validate(modelIdSchema, "params"), modelController.enable);
router.patch("/:id/disable", validate(modelIdSchema, "params"), modelController.disable);
router.patch("/:id/threshold", validate(modelIdSchema, "params"), validate(modelThresholdSchema), modelController.updateThreshold);
router.delete("/:id", validate(modelIdSchema, "params"), modelController.remove);
router.post("/:id/load", validate(modelIdSchema, "params"), modelController.load);
router.post("/:id/unload", validate(modelIdSchema, "params"), modelController.unload);
router.post("/:id/test", validate(modelIdSchema, "params"), modelController.test);

export default router;
