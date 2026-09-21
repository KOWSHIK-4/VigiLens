import { Router } from "express";
import { teamController } from "../controllers/team.controller";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { requireTeamLeadOrManage } from "../middleware/teamAuthorization";
import { validate } from "../middleware/validate";
import {
  acceptInvitationSchema,
  assignTeamMemberSchema,
  createInvitationSchema,
  createTeamSchema,
  invitationParamSchema,
  teamIdSchema,
  teamMemberParamSchema,
  teamQuerySchema,
  updateTeamSchema,
} from "../types";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  requirePermission("teams.read"),
  validate(teamQuerySchema, "query"),
  teamController.getAll,
);
router.get(
  "/:id",
  requirePermission("teams.read"),
  validate(teamIdSchema, "params"),
  teamController.getById,
);
router.post(
  "/",
  requirePermission("teams.manage"),
  validate(createTeamSchema),
  teamController.create,
);
router.patch(
  "/:id",
  requireTeamLeadOrManage,
  validate(teamIdSchema, "params"),
  validate(updateTeamSchema),
  teamController.update,
);
router.post(
  "/:id/members",
  requireTeamLeadOrManage,
  validate(teamIdSchema, "params"),
  validate(assignTeamMemberSchema),
  teamController.assignMember,
);
router.delete(
  "/:id/members/:userId",
  requireTeamLeadOrManage,
  validate(teamMemberParamSchema, "params"),
  teamController.removeMember,
);
router.get(
  "/:id/invitations",
  requirePermission("teams.read"),
  validate(teamIdSchema, "params"),
  teamController.listInvitations,
);
router.post(
  "/:id/invitations",
  requireTeamLeadOrManage,
  validate(teamIdSchema, "params"),
  validate(createInvitationSchema),
  teamController.createInvitation,
);
router.delete(
  "/:id/invitations/:invitationId",
  requireTeamLeadOrManage,
  validate(invitationParamSchema, "params"),
  teamController.revokeInvitation,
);
router.post(
  "/invitations/accept",
  requirePermission("teams.read"),
  validate(acceptInvitationSchema),
  teamController.acceptInvitation,
);
router.delete(
  "/:id",
  requireTeamLeadOrManage,
  validate(teamIdSchema, "params"),
  teamController.remove,
);

export default router;