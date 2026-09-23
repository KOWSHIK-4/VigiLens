import type { Response, NextFunction } from "express";
import type { AuthRequest } from "../types";
import { prisma } from "../config/prisma";
import { error as apiError } from "../utils/apiResponse";

/**
 * Enforces server-side team visibility on data reads.
 *
 * Holders of the org-wide teams.read permission may query any team in their
 * organization. Every other actor is forced onto their own team:
 * - a teamId filter naming their own team passes through;
 * - a teamId filter naming another team in the same organization is rejected
 *   with 403 so teams cannot peek at each other's data;
 * - a teamId filter that does not resolve inside the tenant is rejected with
 *   404 (borrowing the "don't reveal foreign teams" posture);
 * - omitting the filter forces the actor to their own team rather than
 *   silently returning organization-wide rows.
 *
 * The resolved scope is exposed as req.teamScopeId and, for query-driven
 * endpoints, also folded back into req.query.teamId so downstream list
 * handlers apply the same where-clause they already use for explicit filters.
 */
export async function enforceTeamVisibility(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (req.permissions?.has("teams.read")) {
      req.teamScopeId = undefined;
      return next();
    }

    if (!req.organizationId) {
      return apiError(res, "A tenant organization is required", 400);
    }
    if (!req.teamId) {
      return apiError(
        res,
        "Your account is not assigned to a team; contact an administrator",
        403,
      );
    }

    const requested = req.query.teamId as string | undefined;
    if (requested) {
      if (requested === req.teamId) {
        req.query.teamId = req.teamId;
        req.teamScopeId = req.teamId;
        return next();
      }
      const team = await prisma.team.findFirst({
        where: { id: requested, organizationId: req.organizationId },
        select: { id: true },
      });
      if (team) {
        return apiError(res, "Team visibility is limited to your own team", 403);
      }
      return apiError(res, "Team not found", 404);
    }

    req.query.teamId = req.teamId;
    req.teamScopeId = req.teamId;
    return next();
  } catch {
    return apiError(res, "Insufficient permissions", 403);
  }
}