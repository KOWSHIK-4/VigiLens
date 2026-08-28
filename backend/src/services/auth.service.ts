import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { config } from "../config";
import { permissionService } from "./permission.service";
import type { RegisterInput, LoginInput, ChangePasswordInput } from "../types";

const MAX_FAILED_LOGIN_ATTEMPTS = 5;

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      throw new Error("Email already in use");
    }

    const password = await bcrypt.hash(input.password, 12);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        password,
        name: input.name,
        role: "operator",
      },
    });

    const permissions = await permissionService.getPermissionsForRole(user.role);

    const token = this.generateToken(user.id, user.role);

    return { user: this.publicUser(user, permissions), token };
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
    });

    if (!user) {
      throw new Error("Invalid email or password");
    }

    if (user.status === "disabled") {
      throw new Error("Account disabled. Contact your administrator");
    }

    if (user.isLocked) {
      throw new Error("Account locked. Contact your administrator");
    }

    const valid = await bcrypt.compare(input.password, user.password);

    if (!valid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts,
          isLocked: shouldLock,
          lockedAt: shouldLock ? new Date() : user.lockedAt,
        },
      });
      throw new Error("Invalid email or password");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLogin: new Date(),
        failedLoginAttempts: 0,
        isLocked: false,
        lockedAt: null,
      },
    });

    const permissions = await permissionService.getPermissionsForRole(user.role);
    const token = this.generateToken(user.id, user.role);

    return { user: this.publicUser(user, permissions), token };
  },

  async me(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const permissions = await permissionService.getPermissionsForRole(user.role);
    return this.publicUser(user, permissions);
  },

  async changePassword(userId: string, input: ChangePasswordInput) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const valid = await bcrypt.compare(input.currentPassword, user.password);
    if (!valid) {
      throw new Error("Current password is incorrect");
    }

    const hashedPassword = await bcrypt.hash(input.newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        isLocked: false,
        lockedAt: null,
      },
    });

    return { success: true };
  },

  publicUser(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      status: string;
      avatar: string | null;
      isLocked: boolean;
      mustChangePassword: boolean;
      lastLogin: Date | null;
      createdAt: Date;
    },
    permissions: Set<string>,
  ) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
      isLocked: user.isLocked,
      mustChangePassword: user.mustChangePassword,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      permissions: Array.from(permissions),
    };
  },

  generateToken(userId: string, role: string): string {
    return jwt.sign({ userId, role }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn as SignOptions["expiresIn"],
    });
  },
};
