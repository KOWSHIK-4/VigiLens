import bcrypt from "bcrypt";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { ApiError } from "../utils/errors";
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
} as const;

interface FindAllParams extends UserQueryInput {
  page: number;
  limit: number;
}

export const userService = {
  async ensureRoleExists(role: string) {
    const found = await prisma.role.findUnique({ where: { name: role } });
    if (!found) {
      throw new ApiError(400, `Unknown role: ${role}`);
    }
    return found;
  },

  async findAll(params: FindAllParams) {
    const where: Prisma.UserWhereInput = { deletedAt: null };

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

  async findById(id: string) {
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
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

  async create(input: CreateUserInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new ApiError(409, "A user with this email already exists");
    }

    const role = input.role ?? "operator";
    await this.ensureRoleExists(role);

    const password = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        password,
        name: input.name,
        role,
        mustChangePassword: input.mustChangePassword ?? false,
      },
      select: safeSelect,
    });

    logger.info("User created", { userId: user.id, email: user.email, role: user.role });
    return user;
  },

  async update(id: string, input: UpdateUserInput) {
    const existing = await this.findById(id);

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

  async remove(id: string, actorId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot delete your own account");
    }

    const user = await this.findById(id);

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

  async assignRole(id: string, role: string, actorId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot change your own role");
    }

    await this.ensureRoleExists(role);

    const user = await this.findById(id);

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

  async setStatus(id: string, status: UserStatus, actorId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot change your own status");
    }

    const user = await this.findById(id);

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

  async lock(id: string, actorId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot lock your own account");
    }

    const user = await this.findById(id);

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

  async unlock(id: string, actorId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot unlock your own account");
    }

    const user = await this.findById(id);

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

  async resetPassword(id: string, input: ResetPasswordInput) {
    await this.findById(id);
    const hashedPassword = await bcrypt.hash(input.password, 12);
    await prisma.user.update({
      where: { id },
      data: {
        password: hashedPassword,
        mustChangePassword: input.mustChangePassword ?? false,
      },
    });
    logger.info("Password reset", { userId: id });
    return { success: true };
  },

  async stats() {
    const [total, active, disabled, online, locked] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { status: "active", deletedAt: null } }),
      prisma.user.count({ where: { status: "disabled", deletedAt: null } }),
      prisma.user.count({
        where: {
          status: "active",
          deletedAt: null,
          lastLogin: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) },
        },
      }),
      prisma.user.count({ where: { isLocked: true, deletedAt: null } }),
    ]);

    return { total, active, disabled, online, locked };
  },
};
