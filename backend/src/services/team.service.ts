import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import type {
  CreateTeamInput,
  TeamQueryInput,
  UpdateTeamInput,
} from "../types";
import type { Prisma } from "@prisma/client";

const teamSelect = {
  id: true,
  name: true,
  description: true,
  organizationId: true,
  leadId: true,
  lead: { select: { id: true, name: true, email: true } },
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: true } },
} as const;

interface FindAllParams extends TeamQueryInput {
  page: number;
  limit: number;
}

function orgWhere(id: string, organizationId?: string) {
  return {
    id,
    ...(organizationId ? { organizationId } : {}),
  };
}

function ensureOrg(organizationId?: string) {
  if (!organizationId) {
    throw new ApiError(400, "A tenant organization is required");
  }
}

export const teamService = {
  /**
   * Returns the tenant's default team, creating it idempotently on first use.
   * New users are inducted into this team so every tenant member starts on the
   * same "right team"; the lookup is case-insensitive and the create is a
   * race-safe upsert against the (organizationId, name) unique key.
   */
  async getOrCreateDefaultTeam(organizationId: string) {
    const DEFAULT_TEAM_NAME = "Default Team";
    const existing = await prisma.team.findFirst({
      where: { organizationId, name: { equals: DEFAULT_TEAM_NAME, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return existing;
    return prisma.team.upsert({
      where: { organizationId_name: { organizationId, name: DEFAULT_TEAM_NAME } },
      update: {},
      create: {
        name: DEFAULT_TEAM_NAME,
        description: "Default team for inducted members",
        organizationId,
      },
      select: { id: true },
    });
  },

  async findAll(params: FindAllParams, organizationId?: string) {
    ensureOrg(organizationId);
    const where: Prisma.TeamWhereInput = { organizationId };

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { description: { contains: params.search, mode: "insensitive" } },
      ];
    }

    const orderBy: Prisma.TeamOrderByWithRelationInput = {};
    if (params.sortBy) {
      orderBy[params.sortBy as keyof typeof orderBy] = params.sortOrder || "asc";
    } else {
      orderBy.name = "asc";
    }

    const [data, total] = await Promise.all([
      prisma.team.findMany({
        where,
        select: teamSelect,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.team.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string, organizationId?: string) {
    const team = await prisma.team.findFirst({
      where: orgWhere(id, organizationId),
      select: teamSelect,
    });
    if (!team) {
      throw new ApiError(404, "Team not found");
    }
    return team;
  },

  async create(input: CreateTeamInput, organizationId?: string) {
    ensureOrg(organizationId);
    const name = input.name.trim();
    const clash = await prisma.team.findFirst({
      where: { organizationId, name },
      select: { id: true },
    });
    if (clash) {
      throw new ApiError(409, "A team with this name already exists in this organization");
    }

    const team = await prisma.team.create({
      data: {
        name,
        description: input.description ?? "",
        organizationId: organizationId!,
      },
      select: teamSelect,
    });

    logger.info("Team created", { teamId: team.id, name: team.name, organizationId });
    return team;
  },

  async update(id: string, input: UpdateTeamInput, organizationId?: string) {
    const team = await this.findById(id, organizationId);

    const data: Prisma.TeamUpdateInput = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name !== team.name) {
        const clash = await prisma.team.findFirst({
          where: { organizationId, name, id: { not: id } },
          select: { id: true },
        });
        if (clash) {
          throw new ApiError(409, "A team with this name already exists in this organization");
        }
      }
      data.name = name;
    }
    if (input.description !== undefined) data.description = input.description;
    if (input.leadId !== undefined) {
      if (input.leadId === null) {
        data.lead = { disconnect: true };
      } else {
        // Team leads must belong to the tenant and be members of their own
        // team, so a lead always manages a group they are part of.
        const lead = await prisma.user.findFirst({
          where: { id: input.leadId, organizationId, deletedAt: null },
          select: { id: true, teamId: true },
        });
        if (!lead) {
          throw new ApiError(404, "User not found in this organization");
        }
        if (lead.teamId !== id) {
          throw new ApiError(400, "The team lead must be a member of the team");
        }
        data.lead = { connect: { id: lead.id } };
      }
    }

    return prisma.team.update({
      where: { id },
      data,
      select: teamSelect,
    });
  },

  async remove(id: string, organizationId?: string) {
    await this.findById(id, organizationId);
    await prisma.team.delete({ where: { id } });
    logger.info("Team deleted", { teamId: id, organizationId });
    return { success: true, id };
  },

  async assignMember(teamId: string, userId: string, organizationId?: string) {
    const team = await this.findById(teamId, organizationId);
    const user = await prisma.user.findFirst({
      where: { id: userId, organizationId, deletedAt: null },
      select: { id: true, email: true, teamId: true },
    });
    if (!user) {
      throw new ApiError(404, "User not found in this organization");
    }
    if (user.teamId === team.id) {
      throw new ApiError(400, "User is already a member of this team");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { teamId: team.id },
    });
    logger.info("Team member assigned", { teamId: team.id, userId, organizationId });
    return { success: true, teamId: team.id, userId };
  },

  async removeMember(teamId: string, userId: string, organizationId?: string) {
    const team = await this.findById(teamId, organizationId);
    const user = await prisma.user.findFirst({
      where: { id: userId, teamId: team.id, organizationId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!user) {
      throw new ApiError(400, "User is not a member of this team");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { teamId: null },
    });
    logger.info("Team member removed", { teamId: team.id, userId, organizationId });
    return { success: true, teamId: team.id, userId };
  },
};