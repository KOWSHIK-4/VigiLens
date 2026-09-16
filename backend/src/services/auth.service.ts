import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { config } from "../config";
import { permissionService } from "./permission.service";
import { settingsService } from "./settings.service";
import { ApiError } from "../utils/errors";
import type { RegisterInput, LoginInput, ChangePasswordInput } from "../types";

export interface SecurityPolicy {
  maxLoginAttempts: number;
  lockoutDurationMinutes: number;
  passwordMinLength: number;
  requirePasswordComplexity: boolean;
  jwtExpirationHours?: number;
}

const PASSWORD_COMPLEXITY_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

/**
 * Reads the auth-relevant security settings (cached by the settings service,
 * 60s TTL). Values fall back to the sanitized defaults from `settings/defaults`
 * when a deployment has not overridden them.
 */
async function loadSecurityPolicy(): Promise<SecurityPolicy> {
  const [
    maxLoginAttempts,
    lockoutDurationMinutes,
    passwordMinLength,
    requirePasswordComplexity,
    jwtExpirationHours,
  ] = await Promise.all([
    settingsService.getValue("security", "max_login_attempts"),
    settingsService.getValue("security", "lockout_duration_minutes"),
    settingsService.getValue("security", "password_min_length"),
    settingsService.getValue("security", "password_require_complexity"),
    settingsService.getValue("security", "jwt_expiration_hours"),
  ]);
  return {
    maxLoginAttempts: typeof maxLoginAttempts === "number" ? maxLoginAttempts : 5,
    lockoutDurationMinutes:
      typeof lockoutDurationMinutes === "number" ? lockoutDurationMinutes : 15,
    passwordMinLength: typeof passwordMinLength === "number" ? passwordMinLength : 8,
    requirePasswordComplexity: requirePasswordComplexity !== false,
    jwtExpirationHours:
      typeof jwtExpirationHours === "number" && jwtExpirationHours > 0
        ? jwtExpirationHours
        : undefined,
  };
}

function enforcePasswordPolicy(
  password: string,
  policy: Pick<SecurityPolicy, "passwordMinLength" | "requirePasswordComplexity">,
) {
  if (password.length < policy.passwordMinLength) {
    throw new ApiError(
      400,
      `Password must be at least ${policy.passwordMinLength} characters long`,
    );
  }
  if (policy.requirePasswordComplexity && !PASSWORD_COMPLEXITY_PATTERN.test(password)) {
    throw new ApiError(
      400,
      "Password must include uppercase and lowercase letters, a number and a symbol",
    );
  }
}

export const REALTIME_TICKET_TTL_SECONDS = 30;

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      throw new Error("Email already in use");
    }

    const policy = await loadSecurityPolicy();
    enforcePasswordPolicy(input.password, policy);

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

    const token = await this.generateTokenWithVersion(user.id, user.role, policy.jwtExpirationHours);

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

    const policy = await loadSecurityPolicy();

    // Lockouts are temporary (policy-configured). If the lock window has
    // elapsed, clear it so the user is not stranded until an admin intervenes.
    if (user.isLocked && user.lockedAt) {
      const lockMillis = policy.lockoutDurationMinutes * 60_000;
      if (Date.now() - user.lockedAt.getTime() > lockMillis) {
        await prisma.user.update({
          where: { id: user.id },
          data: { isLocked: false, lockedAt: null, failedLoginAttempts: 0 },
        });
        user.isLocked = false;
      }
    }

    if (user.isLocked) {
      throw new Error("Account temporarily locked. Try again later.");
    }

    const valid = await bcrypt.compare(input.password, user.password);

    if (!valid) {
      const failedLoginAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedLoginAttempts >= policy.maxLoginAttempts;
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
    const token = await this.generateTokenWithVersion(user.id, user.role, policy.jwtExpirationHours);

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

  /**
   * Server-side logout: bumps `tokenVersion` so every outstanding JWT for
   * this user is immediately rejected by the auth middleware, regardless of
   * whether the token has not yet expired.
   */
  async logout(userId: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
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

    const policy = await loadSecurityPolicy();
    enforcePasswordPolicy(input.newPassword, policy);
    if (input.currentPassword === input.newPassword) {
      throw new ApiError(400, "New password must be different from the current password");
    }

    const hashedPassword = await bcrypt.hash(input.newPassword, 12);
    // Bump tokenVersion to invalidate all existing sessions on password
    // change — any previously issued JWT will be rejected by the auth
    // middleware as soon as the user tries to use it.
    await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        isLocked: false,
        lockedAt: null,
        tokenVersion: { increment: 1 },
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

  generateToken(userId: string, role: string, expirationHours?: number): string {
    const expiresIn =
      expirationHours !== undefined ? `${expirationHours}h` : config.jwt.expiresIn;
    return jwt.sign({ userId, role }, config.jwt.secret, {
      algorithm: "HS256",
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: expiresIn as SignOptions["expiresIn"],
    });
  },

  /**
   * Issues a signed JWT that carries the user's current `tokenVersion`.
   * The auth middleware compares this claim against the live DB value so
   * that bumping the version (on logout / force-reset) instantly
   * invalidates every outstanding token.
   */
  async generateTokenWithVersion(
    userId: string,
    role: string,
    expirationHours?: number,
  ): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true },
    });
    const tokenVersion = user?.tokenVersion ?? 0;
    const expiresIn =
      expirationHours !== undefined ? `${expirationHours}h` : config.jwt.expiresIn;
    return jwt.sign({ userId, role, tokenVersion }, config.jwt.secret, {
      algorithm: "HS256",
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: expiresIn as SignOptions["expiresIn"],
    });
  },

  /**
   * Issues a short-lived, purpose-limited credential for the realtime SSE
   * stream. The ticket is a single-use JWT that cannot be replayed against
   * any other endpoint and expires quickly so leaked access logs or
   * proxy caches contain only a low-value token.
   */
  issueRealtimeTicket(userId: string, role: string) {
    const ticket = jwt.sign(
      { userId, role, type: "realtime" },
      config.jwt.secret,
      {
        algorithm: "HS256",
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        expiresIn: `${REALTIME_TICKET_TTL_SECONDS}s`,
      },
    );
    return { ticket, expiresInSeconds: REALTIME_TICKET_TTL_SECONDS };
  },
};
