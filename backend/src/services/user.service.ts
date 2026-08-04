import bcrypt from "bcrypt";
import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import { ApiError } from "@/utils/errors";
import type {
  CreateUserInput,
  ResetPasswordInput,
  UpdateUserInput,
  UserQueryInput,
} from "@/types";
import type { Prisma, RoleValue, UserStatus } from "@prisma/client";

const ONLINE_WINDOW_MS = 15 * 60 * 1000;

const safeSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  avatar: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
} as const;

interface FindAllParams extends UserQueryInput {
  page: number;
  limit: number;
}

export const userService = {
  async findAll(params: FindAllParams) {
    const where: Prisma.UserWhereInput = {};

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
    const user = await prisma.user.findUnique({
      where: { id },
      select: safeSelect,
    });
    if (!user) {
      throw new ApiError(404, "User not found");
    }
    return user;
  },

  async create(input: CreateUserInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw new ApiError(409, "A user with this email already exists");
    }

    const password = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        password,
        name: input.name,
        role: input.role ?? "operator",
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
        where: { role: "super_admin" },
      });
      if (superAdmins <= 1) {
        throw new ApiError(400, "Cannot delete the last Super Admin account");
      }
    }

    await prisma.user.delete({ where: { id } });
    logger.info("User deleted", { userId: id, email: user.email });
    return { success: true, id };
  },

  async assignRole(id: string, role: RoleValue, actorId?: string) {
    if (id === actorId) {
      throw new ApiError(400, "You cannot change your own role");
    }

    const user = await this.findById(id);

    if (user.role === "super_admin" && role !== "super_admin") {
      const superAdmins = await prisma.user.count({
        where: { role: "super_admin" },
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
        where: { role: "super_admin" },
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

  async resetPassword(id: string, input: ResetPasswordInput) {
    await this.findById(id);
    const hashedPassword = await bcrypt.hash(input.password, 12);
    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });
    logger.info("Password reset", { userId: id });
    return { success: true };
  },

  async stats() {
    const [total, active, disabled, online] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "active" } }),
      prisma.user.count({ where: { status: "disabled" } }),
      prisma.user.count({
        where: {
          status: "active",
          lastLogin: { gte: new Date(Date.now() - ONLINE_WINDOW_MS) },
        },
      }),
    ]);

    return { total, active, disabled, online };
  },
};
