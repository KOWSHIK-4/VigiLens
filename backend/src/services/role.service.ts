import { prisma } from "../config/prisma";
import { ApiError } from "../utils/errors";
import { permissionService, resolveRole } from "./permission.service";
import { assertActorPossessesPermissions, isSystemRole, SUPER_ADMIN_ROLE } from "./roleHierarchy";
import type { CreateRoleInput, UpdateRoleInput } from "../types";
import type { Prisma } from "@prisma/client";

const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Organization-scoped roles: a custom role is owned by the organization that
 * created it (Role.organizationId) and is unique per (organizationId, name),
 * so two tenants can never collide or inherit each other's role definitions.
 * Seeded system roles are instance-wide (organizationId NULL) and act as the
 * shared baseline every tenant builds on.
 */
export const roleService = {
  async findAll(organizationId?: string) {
    const [roles, users] = await Promise.all([
      prisma.role.findMany({
        where: organizationId
          ? { OR: [{ organizationId }, { organizationId: null }] }
          : { organizationId: null },
        orderBy: [{ organizationId: "desc" }, { name: "asc" }],
        include: {
          permissions: {
            select: { permission: true },
          },
        },
      }),
      prisma.user.groupBy({
        by: ["role"],
        where: organizationId
          ? { deletedAt: null, organizationId }
          : { deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const userCountByRole = new Map(
      users.map((u) => [u.role, u._count._all]),
    );

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.isSystem,
      organizationId: role.organizationId,
      userCount: userCountByRole.get(role.name) ?? 0,
      permissions: role.permissions.map((rp) => rp.permission),
    }));
  },

  async findByName(name: string, organizationId?: string) {
    const resolved = await resolveRole(name, organizationId);
    if (!resolved) {
      throw new ApiError(404, "Role not found");
    }
    const role = await prisma.role.findUnique({
      where: { id: resolved.id },
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

  async create(input: CreateRoleInput, actorPermissions?: Set<string>, organizationId?: string) {
    const name = input.name.trim().toLowerCase();

    if (!ROLE_NAME_PATTERN.test(name)) {
      throw new ApiError(
        400,
        "Role name must be lowercase letters, numbers or underscores",
      );
    }

    if (isSystemRole(name)) {
      throw new ApiError(
        400,
        `Role name "${name}" is reserved by the built-in ${name} role`,
      );
    }

    const existing = await prisma.role.findFirst({
      where: { name, organizationId: organizationId ?? null },
    });
    if (existing) {
      throw new ApiError(409, `A role named "${name}" already exists in this organization`);
    }

    const permissions = await this.resolvePermissions(input.permissionKeys);

    // Granter-possesses: a role may only bundle permissions the actor holds,
    // so an admin cannot mint authority above their own.
    if (actorPermissions) {
      assertActorPossessesPermissions(actorPermissions, input.permissionKeys, name);
    }

    await prisma.$transaction([
      prisma.role.create({
        data: {
          name,
          description: input.description || "",
          isSystem: false,
          organizationId: organizationId ?? null,
        },
      }),
    ]);

    const created = await resolveRole(name, organizationId);
    if (!created) {
      throw new ApiError(500, "Role creation failed");
    }
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: created.id,
          permissionId: permission.id,
        })),
      });
    }

    return this.findByName(name, organizationId);
  },

  async update(name: string, input: UpdateRoleInput, actorPermissions?: Set<string>, organizationId?: string, actorRole?: string) {
    const role = await this.findByName(name, organizationId);
    if (!role) throw new ApiError(404, "Role not found");

    // Instance-wide roles (organizationId NULL) are a shared authorization
    // baseline across every tenant: permission or description edits here
    // would re-shape other organizations' access control, so only an
    // instance administrator (Super Admin) may touch them.
    if (role.organizationId === null && actorRole !== SUPER_ADMIN_ROLE) {
      throw new ApiError(
        403,
        "Global roles are managed at the instance level and can only be edited by a Super Admin",
      );
    }

    const data: Prisma.RoleUpdateInput = {};
    if (input.description !== undefined) {
      data.description = input.description;
    }

    if (input.permissionKeys !== undefined) {
      if (name === "super_admin") {
        throw new ApiError(
          400,
          "Super Admin is a managed role and its permissions cannot be edited",
        );
      }
      const permissions = await this.resolvePermissions(input.permissionKeys);
      if (actorPermissions) {
        assertActorPossessesPermissions(actorPermissions, input.permissionKeys, name);
      }
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
        });
      }
      // Global roles are the shared baseline for every tenant, so a change is
      // cached under each organization's key too (org users fall back to the
      // global role) — clear the whole permission cache to drop all of them.
      permissionService.invalidate(role.organizationId === null ? undefined : `${role.organizationId}:${name}`);
    }

    await prisma.role.update({
      where: { id: role.id },
      data,
    });

    return this.findByName(name, organizationId);
  },

  async updatePermissions(name: string, permissionKeys: string[], actorPermissions?: Set<string>, organizationId?: string, actorRole?: string) {
    return this.update(name, { permissionKeys }, actorPermissions, organizationId, actorRole);
  },

  async remove(name: string, organizationId?: string) {
    const role = await this.findByName(name, organizationId);
    if (!role) throw new ApiError(404, "Role not found");

    if (role.isSystem) {
      throw new ApiError(400, "System roles cannot be deleted");
    }

    // Only the owning organization's active members block deletion; an
    // instance-wide custom role blocks on any active member anywhere.
    const activeUserCount = await prisma.user.count({
      where: {
        role: name,
        deletedAt: null,
        ...(role.organizationId ? { organizationId: role.organizationId } : {}),
      },
    });
    if (activeUserCount > 0) {
      throw new ApiError(
        400,
        `Cannot delete role "${name}" because ${activeUserCount} active user${activeUserCount === 1 ? " is" : "s are"} assigned to it`,
      );
    }

    await prisma.user.updateMany({
      where: {
        role: name,
        ...(role.organizationId ? { organizationId: role.organizationId } : {}),
      },
      data: { role: "viewer" },
    });

    await prisma.role.delete({ where: { id: role.id } });
    permissionService.invalidate(role.organizationId === null ? undefined : `${role.organizationId}:${name}`);
    return { success: true, name };
  },
};