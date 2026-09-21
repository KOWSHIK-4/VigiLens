import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { prisma } from "../config/prisma";
import { error as apiError } from "../utils/apiResponse";

/**
 * Authorizes team-scoped mutations. Holders of the teams.manage permission may
 * manage every team; a team's lead may manage just their own team. The team is
 * resolved scoped to the caller's tenant so a cross-tenant id 404s and never
 * reveals another organization's team.
 */
export async function requireTeamLeadOrManage(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.organizationId) {
      return apiError(res, "A tenant organization is required", 400);
    }
    const manage = req.permissions?.has("teams.manage");
    if (manage) return next();

    const teamId = req.params.id as string | undefined;
    if (!teamId) {
      return apiError(res, "Invalid team id", 400);
    }
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId: req.organizationId },
      select: { id: true, leadId: true },
    });
    if (!team) {
      return apiError(res, "Team not found", 404);
    }
    if (team.leadId && team.leadId === req.userId) {
      return next();
    }
    return apiError(res, "Insufficient permissions", 403);
  } catch {
    return apiError(res, "Insufficient permissions", 403);
  }
}