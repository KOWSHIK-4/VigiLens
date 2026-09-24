import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { prisma } from "../config/prisma";
import { subscribe, getSubscriberSnapshot } from "../services/realtime.service";
import { success, error as apiError } from "../utils/apiResponse";
import type { AuthRequest } from "../types";

const router = Router();

const MAX_TEAM_SCOPE = 100;
const TEAM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A team channel is only surfable when the requesting user can actually see
 * that team: members may scope to their own team, and any tenant member with
 * the org-wide `teams.read` permission may scope to any team in the tenant.
 * Team ids that do not belong to the caller's organization fail closed (403),
 * so a subscriber can never eavesdrop on another tenant's scoped events.
 */
async function authorizeTeamScope(
  authReq: AuthRequest,
  rawTeamIds: string[],
): Promise<{ teamIds?: string[]; error?: string }> {
  if (rawTeamIds.length === 0) {
    return { teamIds: undefined };
  }
  if (!authReq.userId || !authReq.organizationId) {
    return { error: "Tenant context is required to subscribe to team channels" };
  }
  if (rawTeamIds.length > MAX_TEAM_SCOPE) {
    return { error: `A stream may scope to at most ${MAX_TEAM_SCOPE} team channels` };
  }

  const uniqueIds = Array.from(new Set(rawTeamIds));
  const malformed = uniqueIds.filter((id) => !TEAM_ID_PATTERN.test(id));
  if (malformed.length > 0) {
    return { error: "Malformed team id in teamIds" };
  }

  const orgTeams = await prisma.team.findMany({
    where: { id: { in: uniqueIds }, organizationId: authReq.organizationId },
    select: { id: true },
  });
  const orgTeamIds = new Set(orgTeams.map((team) => team.id));
  const foreign = uniqueIds.filter((id) => !orgTeamIds.has(id));
  if (foreign.length > 0) {
    return { error: "Requested team channel does not exist in your organization" };
  }

  const orgWide = authReq.permissions?.has("teams.read") ?? false;
  const denied = uniqueIds.filter((id) => id !== authReq.teamId && !orgWide);
  if (denied.length > 0) {
    return { error: "You do not have permission to subscribe to that team channel" };
  }

  return { teamIds: uniqueIds };
}

router.get("/events", authenticate, async (req, res, next) => {
  const authReq = req as AuthRequest;
  if (!authReq.userId) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Authentication required" }));
    return;
  }
  const rawTeamIds = typeof req.query.teamIds === "string" ? req.query.teamIds : "";
  const teamIds = rawTeamIds
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  try {
    const scope = await authorizeTeamScope(authReq, teamIds);
    if (scope.error) {
      return apiError(res, scope.error, 403);
    }

    subscribe(authReq.userId, res, authReq.organizationId, scope.teamIds);
  } catch (err) {
    next(err);
  }
});

router.get("/subscribers", authenticate, (req, res) => {
  const authReq = req as AuthRequest;
  const snapshot = getSubscriberSnapshot();
  const canViewAll = authReq.permissions?.has("teams.read") ?? false;
  // The snapshot is always scoped to the caller's tenant: a teams.read holder
  // sees their own organization's subscribers, never another tenant's. Other
  // members only see their own subscriptions, and the reported count matches
  // whatever is visible -- so neither the list nor the count leaks across
  // organizations.
  const visible = canViewAll
    ? snapshot.filter((sub) => !sub.organizationId || sub.organizationId === authReq.organizationId)
    : snapshot.filter((sub) => sub.userId === authReq.userId);
  success(res, {
    count: visible.length,
    subscribers: visible,
  });
});

export default router;