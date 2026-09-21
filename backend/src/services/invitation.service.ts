import crypto from "crypto";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import type { AcceptInvitationInput, CreateInvitationInput } from "../types";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function assertTeam(teamId: string, organizationId: string) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId },
    select: { id: true, name: true },
  });
  if (!team) throw new ApiError(404, "Team not found");
  return team;
}

export const invitationService = {
  /**
   * Creates a revocable, expiring invitation for an email address. The raw
   * token is shown once on creation so the inviter can hand it out; only a
   * SHA-256 digest is stored, so a leaked database cannot mint invitations.
   */
  async create(teamId: string, input: CreateInvitationInput, organizationId: string, inviterUserId: string) {
    const team = await assertTeam(teamId, organizationId);
    const email = input.email.trim().toLowerCase();

    const duplicate = await prisma.teamInvitation.findFirst({
      where: { teamId, email, status: "pending" },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiError(409, "A pending invitation already exists for this email and team");
    }

    const token = crypto.randomBytes(TOKEN_BYTES).toString("hex");
    const invitation = await prisma.teamInvitation.create({
      data: {
        tokenHash: hashToken(token),
        email,
        teamId: team.id,
        inviterUserId,
        organizationId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        teamId: true,
      },
    });

    logger.info("Team invitation created", {
      invitationId: invitation.id,
      teamId: team.id,
      email,
      organizationId,
      inviterUserId,
    });
    return { invitation, token };
  },

  async findAll(teamId: string, organizationId: string) {
    const team = await assertTeam(teamId, organizationId);
    return prisma.teamInvitation.findMany({
      where: { teamId: team.id, organizationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        acceptedAt: true,
        teamId: true,
        inviterUserId: true,
      },
    });
  },

  async revoke(invitationId: string, teamId: string, organizationId: string) {
    const invitation = await prisma.teamInvitation.findFirst({
      where: { id: invitationId, teamId, organizationId },
      select: { id: true, status: true },
    });
    if (!invitation) throw new ApiError(404, "Invitation not found");
    if (invitation.status !== "pending") {
      throw new ApiError(400, "Only pending invitations can be revoked");
    }
    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: "revoked" },
    });
    return { message: "Invitation revoked" };
  },

  /**
   * Self-service acceptance. The raw token is the credential (magic-link
   * style); the acceptor must be signed in as a user of the team's own tenant
   * and, when the invitation names an email, that email must match the current
   * user so a token cannot be used to force strangers into a team.
   */
  async accept(input: AcceptInvitationInput, user: { id: string; email: string; organizationId: string }) {
    const token = input.token.trim();
    const invitation = await prisma.teamInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        teamId: true,
        organizationId: true,
      },
    });
    if (!invitation) throw new ApiError(404, "Invitation not found or already used");
    if (invitation.organizationId !== user.organizationId) {
      throw new ApiError(404, "Invitation not found");
    }
    if (invitation.status === "accepted") {
      throw new ApiError(409, "Invitation already accepted");
    }
    const now = Date.now();
    if (invitation.status === "expired" || invitation.expiresAt.getTime() < now) {
      if (invitation.status !== "expired") {
        await prisma.teamInvitation.update({
          where: { id: invitation.id },
          data: { status: "expired" },
        });
      }
      throw new ApiError(410, "Invitation has expired");
    }
    if (invitation.status !== "pending") {
      throw new ApiError(400, "Invitation is no longer valid");
    }
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ApiError(403, "This invitation was issued to a different email address");
    }

    const member = await prisma.user.findFirst({
      where: { id: user.id, organizationId: user.organizationId },
      select: { id: true, teamId: true },
    });
    if (!member) throw new ApiError(404, "User not found");
    if (member.teamId !== invitation.teamId) {
      await prisma.user.update({
        where: { id: member.id },
        data: { teamId: invitation.teamId },
      });
    }

    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });

    logger.info("Team invitation accepted", {
      invitationId: invitation.id,
      teamId: invitation.teamId,
      userId: user.id,
    });
    return { message: "Invitation accepted", teamId: invitation.teamId };
  },
};