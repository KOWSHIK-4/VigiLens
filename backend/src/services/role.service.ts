import { prisma } from "@/config/prisma";
import { ApiError } from "@/utils/errors";
import { permissionService } from "@/services/permission.service";
import type { CreateRoleInput, UpdateRoleInput } from "@/types";
import type { Prisma } from "@prisma/client";

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

export const roleService = {
  async findAll() {
    const [roles, users] = await Promise.all([
      prisma.role.findMany({
        orderBy: { name: "asc" },
        include: {
          permissions: {
            select: { permission: true },
          },
        },
      }),
      prisma.user.groupBy({
        by: ["role"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const userCountByRole = new Map(
      users.map((u) => [u.role, u._count._all]),
    );

    return roles.map((role) => ({
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      userCount: userCountByRole.get(role.name) ?? 0,
      permissions: role.permissions.map((rp) => rp.permission),
    }));
  },

  async findByName(name: string) {
    const role = await prisma.role.findUnique({
      where: { name },
      include: {
        permissions: {
          select: { permission: true },
        },
      },
    });
    if (!role) {
      throw new ApiError(404, "Role not found");
    }
    return role;
  },

  async resolvePermissions(permissionKeys: string[]) {
    if (permissionKeys.length === 0) return [];
    const permissions = await prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
    });

    const validKeys = new Set(permissions.map((p) => p.key));
    const unknownKeys = permissionKeys.filter((k) => !validKeys.has(k));
    if (unknownKeys.length > 0) {
      throw new ApiError(
        400,
        `Unknown permission key${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys.join(", ")}`,
      );
    }
    return permissions;
  },

  async create(input: CreateRoleInput) {
    const name = input.name.trim().toLowerCase();

    if (!ROLE_NAME_PATTERN.test(name)) {
      throw new ApiError(
        400,
        "Role name must be lowercase letters, numbers or underscores",
      );
    }

    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) {
      throw new ApiError(409, `A role named "${name}" already exists`);
    }

    const permissions = await this.resolvePermissions(input.permissionKeys);

    await prisma.$transaction([
      prisma.role.create({
        data: {
          name,
          description: input.description || "",
          isSystem: false,
        },
      }),
      prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          role: name,
          permissionId: permission.id,
        })),
      }),
    ]);

    return this.findByName(name);
  },

  async update(name: string, input: UpdateRoleInput) {
    await this.findByName(name);

    const data: Prisma.RoleUpdateInput = {};
    if (input.description !== undefined) {
      data.description = input.description;
    }

    if (input.permissionKeys !== undefined) {
      if (name === "super_admin") {
        throw new ApiError(
          400,
          "Super Admin is a system-managed role and its permissions cannot be edited",
        );
      }
      const permissions = await this.resolvePermissions(input.permissionKeys);
      await prisma.rolePermission.deleteMany({ where: { role: name } });
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          role: name,
          permissionId: permission.id,
        })),
      });
      permissionService.invalidate(name);
    }

    await prisma.role.update({
      where: { name },
      data,
    });

    return this.findByName(name);
  },

  async updatePermissions(name: string, permissionKeys: string[]) {
    return this.update(name, { permissionKeys });
  },

  async remove(name: string) {
    const role = await this.findByName(name);

    if (role.isSystem) {
      throw new ApiError(400, "System roles cannot be deleted");
    }

    const activeUserCount = await prisma.user.count({
      where: { role: name, deletedAt: null },
    });
    if (activeUserCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete role "${name}" because ${activeUserCount} active user${activeUserCount === 1 ? " is" : "s are"} assigned to it`,
      );
    }

    await prisma.user.updateMany({
      where: { role: name },
      data: { role: "viewer" },
    });

    await prisma.role.delete({ where: { name } });
    permissionService.invalidate(name);
    return { success: true, name };
  },
};
