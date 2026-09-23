import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { prisma } from "../config/prisma";
import type { AuthRequest } from "../types";
import { error as apiError } from "../utils/apiResponse";
import { permissionService } from "../services/permission.service";
import { settingsService } from "../services/settings.service";

interface JwtPayload {
  userId: string;
  role: string;
  tokenVersion?: number;
  organizationId?: string;
  sid?: string;
}

const ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED = new Set([
  "/change-password",
  "/me",
  "/logout",
]);

// Routes an MFA-enforced deployment still lets an un-enrolled user reach:
// the enrollment endpoints themselves, their own profile and logout.
const ALLOWED_WITHOUT_MFA = new Set([
  "/mfa/setup",
  "/mfa/verify",
  "/me",
  "/change-password",
  "/logout",
]);

export async function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  // EventSource cannot set the Authorization header, so the realtime stream
  // endpoint (`/api/realtime/events`) authenticates with a short-lived
  // ?ticket= query parameter instead. The credential carried here is a
  // purpose-limited token issued by POST /auth/realtime-ticket (30s TTL,
  // type: "realtime"); the user's access JWT is rejected in the query so a
  // long-lived token never ends up in proxy or access logs.
  const isRealtimeStream =
    req.originalUrl?.split("?")[0] === "/api/realtime/events";
  const queryTicket =
    isRealtimeStream && typeof req.query.ticket === "string" && req.query.ticket.length > 0
      ? req.query.ticket
      : undefined;

  if (!header?.startsWith("Bearer ") && !queryTicket) {
    return apiError(res, "Authentication required", 401);
  }

  try {
    const rawToken = queryTicket ?? header!.split(" ")[1];
    const decoded = jwt.verify(rawToken, config.jwt.secret, {
      // Pin the algorithm and token claims so a JWT with a different (or no)
      // algorithm header — e.g. "none" — or a foreign issuer/audience is
      // rejected outright.
      algorithms: ["HS256"],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    }) as JwtPayload & { type?: string; iat?: number };

    if (queryTicket && decoded.type !== "realtime") {
      return apiError(res, "Invalid or expired token", 401);
    }
    req.userId = decoded.userId;
    req.userRole = decoded.role;

    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, deletedAt: null },
      select: {
        id: true,
        status: true,
        role: true,
        isLocked: true,
        mustChangePassword: true,
        mfaEnabled: true,
        tokenVersion: true,
        organizationId: true,
        teamId: true,
      },
    });

    if (!user) {
      return apiError(res, "User no longer exists", 401);
    }
    if (user.status === "disabled") {
      return apiError(res, "Account disabled. Contact your administrator", 403);
    }
    if (user.isLocked) {
      return apiError(res, "Account temporarily locked. Try again later.", 403);
    }

    // Reject tokens issued before the user's tokenVersion was bumped (logout,
    // force-reset). The version is embedded in the JWT at issuance time; if
    // the DB value has moved on, the token is stale.
    if (
      decoded.tokenVersion !== undefined &&
      decoded.tokenVersion !== user.tokenVersion
    ) {
      return apiError(res, "Session invalidated. Please log in again.", 401);
    }

    // Realtime stream tickets are purpose-limited (30s TTL, no sid claim), so
    // session lifecycle and MFA policy do not apply to them. Session state is
    // enforced only for full bearer tokens that carry a session id.
    const isRealtimeTicket = decoded.type === "realtime";

    // Enforce the session_timeout_minutes policy as a true INACTIVITY window:
    // the timestamp lives on a per-session row and is slid forward on every
    // request, so an actively-used token never expires mid-flight. Tokens
    // issued without a recorded session (e.g. legacy path) still rely on the
    // version check above plus the JWT's absolute `exp` as the hard cap.
    if (!isRealtimeTicket && decoded.sid) {
      const session = await prisma.userSession.findUnique({
        where: { id: decoded.sid },
      });
      if (!session || session.userId !== decoded.userId) {
        return apiError(res, "Session invalidated. Please log in again.", 401);
      }
      const timeoutMinutes = await settingsService.getValue(
        "security",
        "session_timeout_minutes",
      );
      const timeoutMs = (typeof timeoutMinutes === "number" ? timeoutMinutes : 0) * 60_000;
      if (timeoutMs > 0) {
        const idleMs = Date.now() - session.lastActivityAt.getTime();
        if (idleMs > timeoutMs) {
          return apiError(res, "Session expired. Please log in again.", 401);
        }
      }
      await prisma.userSession.updateMany({
        where: { id: session.id },
        data: { lastActivityAt: new Date() },
      });
    }

    // MFA policy: when the deployment enforces MFA org-wide, an account that
    // has not enrolled is restricted to the enrollment flow until it does.
    if (!isRealtimeTicket) {
      const mfaEnforced = await settingsService.getValue("security", "mfa_enforced");
      if (mfaEnforced === true && !user.mfaEnabled && !ALLOWED_WITHOUT_MFA.has(req.path)) {
        return apiError(res, "MFA enrollment required", 403, {
          code: "MFA_ENROLLMENT_REQUIRED",
        });
      }
    }

    if (
      user.mustChangePassword &&
      !ALLOWED_WHILE_PASSWORD_CHANGE_REQUIRED.has(req.path)
    ) {
      return apiError(res, "Password change required", 403, {
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    req.userRole = user.role;
    // The tenant scope is always derived from the database row -- never from
    // the JWT claim -- so a stale or forged org in a token cannot move a user
    // into another tenant. The token claim is only used by the realtime
    // ticket flow, which re-validates against the DB here as well.
    req.organizationId = user.organizationId;
    req.teamId = user.teamId ?? undefined;
    req.permissions = await permissionService.getPermissionsForRole(user.role, user.organizationId);
    next();
  } catch {
    return apiError(res, "Invalid or expired token", 401);
  }
}

export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return apiError(res, "Insufficient permissions", 403);
    }
    next();
  };
}
