import { Router } from "express";
import { incidentController } from "../controllers/incident.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { validate } from "../middleware/validate";
import {
  incidentQuerySchema,
  incidentIdSchema,
  createIncidentSchema,
  updateIncidentStatusSchema,
  updateIncidentPrioritySchema,
  assignIncidentSchema,
  addIncidentNoteSchema,
} from "../types";

const router = Router();

router.use(authenticate);

router.get("/", requirePermission("alerts.read"), validate(incidentQuerySchema, "query"), incidentController.getAll);
router.get("/summary", requirePermission("alerts.read"), incidentController.getSummary);
router.get("/:id", requirePermission("alerts.read"), validate(incidentIdSchema, "params"), incidentController.getById);
router.post("/", requirePermission("alerts.manage"), validate(createIncidentSchema, "body"), incidentController.create);
router.patch("/:id/status", requirePermission("alerts.manage"), validate(incidentIdSchema, "params"), validate(updateIncidentStatusSchema, "body"), incidentController.updateStatus);
router.patch("/:id/priority", requirePermission("alerts.manage"), validate(incidentIdSchema, "params"), validate(updateIncidentPrioritySchema, "body"), incidentController.updatePriority);
router.patch("/:id/assign", requirePermission("alerts.manage"), validate(incidentIdSchema, "params"), validate(assignIncidentSchema, "body"), incidentController.assign);
router.post("/:id/notes", requirePermission("alerts.manage"), validate(incidentIdSchema, "params"), validate(addIncidentNoteSchema, "body"), incidentController.addNote);

export default router;