import bcrypt from "bcrypt";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
import { teamService } from "./team.service";
import type {
  CreateUserInput,
  ResetPasswordInput,
  UpdateUserInput,
  UserQueryInput,
} from "../types";
import type { Prisma, UserStatus } from "@prisma/client";

const ONLINE_WINDOW_MS = 15 * 60 * 1000;

const safeSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  avatar: true,
  isLocked: true,
  failedLoginAttempts: true,
  lockedAt: true,
  mustChangePassword: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
  organizationId: true,
  teamId: true,
} as const;

interface FindAllParams extends UserQueryInput {
  page: number;
  limit: number;
}

function orgWhere(id: string, organizationId?: string) {
  return {
    id,
    deletedAt: null,
    ...(organizationId ? { organizationId } : {}),
  };
}

export const userService = {
  async ensureRoleExists(role: string) {
    const found = await prisma.role.findUnique({ where: { name: role } });
    if (!found) {
      throw new ApiError(400, `Unknown role: ${role}`);
    }
    return found;
  },

  async findAll(params: FindAllParams, organizationId?: string) {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (organizationId) where.organizationId = organizationId;

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: "insensitive" } },
        { email: { contains: params.search, mode: "insensitive" } },
      ];
    }

    if (params.role) {
      where.role = params.role;
    }

    if (params.status) {
      where.status = params.status;
    }

    const orderBy: Prisma.UserOrderByWithRelationInput = {};
    if (params.sortBy) {
      orderBy[params.sortBy as keyof typeof orderBy] = params.sortOrder || "asc";
    } else {
      orderBy.createdAt = "desc";
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: safeSelect,
        orderBy,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.user.count({ where }),
    ]);

    return { data, total };
  },

  async findById(id: string, organizationId?: string) {
    const user = await prisma.user.findFirst({
      where: orgWhere(id, organizationId),
      select: safeSelect,
    });
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    return user;
  },

  async findByEmail(email: string) {
    return prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: safeSelect,
    });
  },

  async create(input: CreateUserInput, organizationId?: string) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new ApiError(409, "A user with this email already exists");
    }

    const role = input.role ?? "operator";
    await this.ensureRoleExists(role);

    const password = await bcrypt.hash(input.password, 12);

    if (!organizationId) {
      throw new ApiError(400, "A tenant organization is required to create a user");
    }

    // Join-the-right-team induction: every new tenant member starts on the
    // organization's default team so new accounts are never left ungrouped.
    const defaultTeam = await teamService.getOrCreateDefaultTeam(organizationId);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        password,
        name: input.name,
        role,
        mustChangePassword: input.mustChangePassword ?? false,
        organizationId,
        teamId: defaultTeam.id,
      },
      select: safeSelect,
    });

    logger.info("User created", { userId: user.id, email: user.email, role: user.role });
    return user;
  },

  async update(id: string, input: UpdateUserInput, organizationId?: string) {
    const existing = await this.findById(id, organizationId);

    if (input.email && input.email !== existing.email) {
      const clash = await prisma.user.findUnique({
        where: { email: input.email },
      });
      if (clash) {
        throw new ApiError(409, "A user with this email already exists");
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.email !== undefined) data.email = input.email;
    if (input.avatar !== undefined) data.avatar = input.avatar;

    return prisma.user.update({
      where: { id },
      data,
      select: safeSelect,
    });
  },

  async remove(id: string, actorId?: string, organizationId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot delete your own account");
    }

    const user = await this.findById(id, organizationId);

    if (user.role === "super_admin") {
      const superAdmins = await prisma.user.count({
        where: { role: "super_admin", deletedAt: null },
      });
      if (superAdmins <= 1) {
        throw new ApiError(400, "Cannot delete the last Super Admin account");
      }
    }

    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), status: "disabled" },
    });
    logger.info("User soft-deleted", { userId: id, email: user.email });
    return { success: true, id };
  },

  async assignRole(id: string, role: string, actorId?: string, organizationId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot change your own role");
    }

    await this.ensureRoleExists(role);

    const user = await this.findById(id, organizationId);

    if (user.role === "super_admin" && role !== "super_admin") {
      const superAdmins = await prisma.user.count({
        where: { role: "super_admin", deletedAt: null },
      });
      if (superAdmins <= 1) {
        throw new ApiError(
          400,
          "Cannot demote the last Super Admin account",
        );
      }
    }

    return prisma.user.update({
      where: { id },
      data: { role },
      select: safeSelect,
    });
  },

  async setStatus(id: string, status: UserStatus, actorId?: string, organizationId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot change your own status");
    }

    const user = await this.findById(id, organizationId);

    if (user.role === "super_admin" && status === "disabled") {
      const superAdmins = await prisma.user.count({
        where: { role: "super_admin", deletedAt: null },
      });
      if (superAdmins <= 1) {
        throw new ApiError(400, "Cannot disable the last Super Admin account");
      }
    }

    return prisma.user.update({
      where: { id },
      data: { status },
      select: safeSelect,
    });
  },

  async lock(id: string, actorId?: string, organizationId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot lock your own account");
    }

    const user = await this.findById(id, organizationId);

    if (user.isLocked) {
      throw new ApiError(400, "This account is already locked");
    }

    return prisma.user.update({
      where: { id },
      data: {
        isLocked: true,
        lockedAt: new Date(),
        failedLoginAttempts: 0,
      },
      select: safeSelect,
    });
  },

  async unlock(id: string, actorId?: string, organizationId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot unlock your own account");
    }

    const user = await this.findById(id, organizationId);

    if (!user.isLocked) {
      throw new ApiError(400, "This account is not locked");
    }

    return prisma.user.update({
      where: { id },
      data: {
        isLocked: false,
        lockedAt: null,
        failedLoginAttempts: 0,
      },
      select: safeSelect,
    });
  },

  async resetPassword(id: string, input: ResetPasswordInput, organizationId?: string) {
    await this.findById(id, organizationId);
    const hashedPassword = await bcrypt.hash(input.password, 12);
    // Bump tokenVersion to revoke every outstanding session for the account.
    // An admin resetting a compromised password must not leave the attacker's
    // previously-issued JWTs valid until they expire.
    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
        mustChangePassword: input.mustChangePassword ?? false,
        failedLoginAttempts: 0,
        isLocked: false,
        lockedAt: null,
        tokenVersion: { increment: 1 },
      },
    });
    logger.info("Password reset", { userId: id });
    return { success: true };
  },

  async stats(organizationId?: string) {
    const scope: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(organizationId ? { organizationId } : {}),
    };
    const [total, active, disabled, online, locked] = await Promise.all([
      prisma.user.count({ where: scope }),
      prisma.user.count({ where: { ...scope, status: "active" } }),
      prisma.user.count({ where: { ...scope, status: "disabled" } }),
      prisma.user.count({
        where: {
          ...scope,
          status: "active",
          lastLogin: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) },
        },
      }),
      prisma.user.count({ where: { ...scope, isLocked: true } }),
    ]);

    return { total, active, disabled, online, locked };
  },
};
