import { Router } from "express";
import { modelController } from "@/controllers/model.controller";
import { authenticate } from "@/middleware/auth";
import { validate } from "@/middleware/validate";
import { modelIdSchema, modelQuerySchema, updateModelSchema } from "@/types";

const router = Router();

router.use(authenticate);

router.get("/", validate(modelQuerySchema, "query"), modelController.getAll);
router.get("/:id", validate(modelIdSchema, "params"), modelController.getById);
router.patch("/:id", validate(modelIdSchema, "params"), validate(updateModelSchema), modelController.update);
router.post("/:id/load", validate(modelIdSchema, "params"), modelController.load);
router.post("/:id/unload", validate(modelIdSchema, "params"), modelController.unload);
router.post("/:id/test", validate(modelIdSchema, "params"), modelController.test);

export default router;
