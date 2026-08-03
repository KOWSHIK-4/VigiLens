import { prisma } from "@/config/prisma";
import { ApiError } from "@/utils/errors";
import { permissionService } from "@/services/permission.service";
import type { RoleValue } from "@prisma/client";

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

  async findByName(name: RoleValue) {
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

  async updatePermissions(name: RoleValue, permissionKeys: string[]) {
    if (name === "super_admin") {
      throw new ApiError(
        400,
        "Super Admin is a system-managed role and its permissions cannot be edited",
      );
    }

    const role = await this.findByName(name);

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

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { role: role.name } }),
      prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          role: role.name,
          permissionId: permission.id,
        })),
      }),
    ]);

    permissionService.invalidate(role.name);

    return this.findByName(role.name);
  },
};
