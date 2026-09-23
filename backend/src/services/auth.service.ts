import bcrypt from "bcrypt";
import jwt, { type SignOptions } from "jsonwebtoken";
import { prisma } from "../config/prisma";
import { config } from "../config";
import { permissionService } from "./permission.service";
import { settingsService } from "./settings.service";
import { teamService } from "./team.service";
import {
  generateSecret,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyTotpCode,
  verifyAndConsumeRecoveryCode,
} from "./mfa.service";
import { ApiError } from "../utils/errors";
import type { RegisterInput, LoginInput, ChangePasswordInput } from "../types";

export interface SessionMeta {
  ipAddress?: string;
  userAgent?: string;
}

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

/**
 * Resolves the tenant every authenticated route derives its scope from.
 * Registration assigns the deterministic default organization so self-signed
 * accounts are never left without a tenant.
 */
export async function resolveDefaultOrganizationId(): Promise<string> {
  const org = await prisma.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: { name: "Default Organization", slug: "default", description: "" },
  });
  return org.id;
}

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

    const organizationId = await resolveDefaultOrganizationId();
    // Join-the-right-team induction: self-signed accounts land on the default
    // organization (see resolveDefaultOrganizationId) and are inducted into
    // that tenant's default team.
    const defaultTeam = await teamService.getOrCreateDefaultTeam(organizationId);

    const user = await prisma.user.create({
      data: {
        email: input.email,
        password,
        name: input.name,
        role: "operator",
        organizationId,
        teamId: defaultTeam.id,
      },
    });

    const permissions = await permissionService.getPermissionsForRole(user.role, user.organizationId);

    const session = await prisma.userSession
      .create({
        data: { userId: user.id, tokenVersion: user.tokenVersion },
      })
      .catch(() => null);

    const token = await this.generateTokenWithVersion(
      user.id,
      user.role,
      policy.jwtExpirationHours,
      session?.id,
    );

    return { user: this.publicUser(user, permissions), token };
  },

  async login(input: LoginInput, meta?: SessionMeta) {
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
      await this.recordFailedLogin(user, policy);
      throw new Error("Invalid email or password");
    }

    // Second-factor challenge. The password has already verified, so a missing
    // code is NOT counted as a failed attempt -- the client is asked to prompt
    // for it. A wrong TOTP or clipped recovery code is a real auth failure.
    if (user.mfaEnabled) {
      if (input.totpCode) {
        if (!verifyTotpCode(user.mfaSecret, input.totpCode)) {
          await this.recordFailedLogin(user, policy);
          throw new ApiError(401, "Invalid MFA code");
        }
      } else if (input.recoveryCode) {
        const usedUp = await verifyAndConsumeRecoveryCode(user.id, input.recoveryCode);
        if (!usedUp) {
          await this.recordFailedLogin(user, policy);
          throw new ApiError(401, "Invalid recovery code");
        }
      } else {
        throw new ApiError(401, "MFA code required", { code: "MFA_REQUIRED" });
      }
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

    const permissions = await permissionService.getPermissionsForRole(user.role, user.organizationId);
    const session = await prisma.userSession
      .create({
        data: {
          userId: user.id,
          tokenVersion: user.tokenVersion,
          ipAddress: meta?.ipAddress,
          userAgent: meta?.userAgent,
        },
      })
      .catch(() => null);

    const token = await this.generateTokenWithVersion(
      user.id,
      user.role,
      policy.jwtExpirationHours,
      session?.id,
    );

    return { user: this.publicUser(user, permissions), token };
  },

  /**
   * Records a failed credential attempt and triggers the policy-configured
   * temporary account lock once the limit is reached.
   */
  async recordFailedLogin(
    user: { id: string; failedLoginAttempts: number; lockedAt: Date | null },
    policy: SecurityPolicy,
  ) {
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
  },

  async me(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new Error("User not found");
    }

    const permissions = await permissionService.getPermissionsForRole(user.role, user.organizationId);
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
    // change â€” any previously issued JWT will be rejected by the auth
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

  /**
   * Begins MFA enrollment: generates a TOTP secret and returns the otpauth
   * provisioning URI. The secret is persisted (but not yet enabled) so the
   * follow-up `mfaVerify` call can be authenticated against it.
   */
  async mfaSetup(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { email: true, mfaEnabled: true },
    });
    if (!user) {
      throw new Error("User not found");
    }
    if (user.mfaEnabled) {
      throw new ApiError(400, "MFA is already enabled");
    }
    const { secret, otpauthUrl } = await generateSecret(user.email);
    await prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret },
    });
    return { secret, otpauthUrl };
  },

  /**
   * Completes enrollment after the user proves they scanned the secret. On
   * success it flips MFA on, stores single-use recovery codes (hashed, so the
   * plaintext is shown exactly once) and returns them for safe-keeping.
   */
  async mfaVerify(userId: string, code: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { mfaSecret: true, mfaEnabled: true },
    });
    if (!user) {
      throw new Error("User not found");
    }
    if (user.mfaEnabled) {
      throw new ApiError(400, "MFA is already enabled");
    }
    if (!verifyTotpCode(user.mfaSecret, code)) {
      throw new ApiError(400, "Invalid code");
    }
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: true,
        mfaRecoveryCodes: hashRecoveryCodes(recoveryCodes),
      },
    });
    return { enabled: true, recoveryCodes };
  },

  async mfaDisable(userId: string, password: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { password: true, mfaEnabled: true },
    });
    if (!user) {
      throw new Error("User not found");
    }
    if (!user.mfaEnabled) {
      throw new ApiError(400, "MFA is not enabled");
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new ApiError(400, "Current password is incorrect");
    }
    await prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null },
    });
    return { enabled: false };
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
      mfaEnabled: boolean;
      lastLogin: Date | null;
      createdAt: Date;
      organizationId: string;
      teamId: string | null;
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
      mfaEnabled: user.mfaEnabled,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
      organizationId: user.organizationId,
      teamId: user.teamId,
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
    sid?: string,
  ): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tokenVersion: true, organizationId: true },
    });
    const tokenVersion = user?.tokenVersion ?? 0;
    const organizationId = user?.organizationId;
    const expiresIn =
      expirationHours !== undefined ? `${expirationHours}h` : config.jwt.expiresIn;
    return jwt.sign(
      { userId, role, tokenVersion, organizationId, ...(sid ? { sid } : {}) },
      config.jwt.secret,
      {
        algorithm: "HS256",
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        expiresIn: expiresIn as SignOptions["expiresIn"],
      },
    );
  },

  /**
   * Issues a short-lived, purpose-limited credential for the realtime SSE
   * stream. The ticket is a single-use JWT that cannot be replayed against
   * any other endpoint and expires quickly so leaked access logs or
   * proxy caches contain only a low-value token.
   */
  issueRealtimeTicket(userId: string, role: string, organizationId?: string) {
    const ticket = jwt.sign(
      { userId, role, organizationId, type: "realtime" },
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
