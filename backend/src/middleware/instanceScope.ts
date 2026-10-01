import type { RequestHandler } from "express";
import type { AuthRequest } from "../types";
import { SUPER_ADMIN_ROLE } from "../services/roleHierarchy";

/**
 * Restricts a mutation on an instance-wide singleton to an instance
 * administrator.
 *
 * Most resources in this schema carry `organizationId` and are scoped by the
 * tenant middleware. `AIModel`, `DetectorSettings` and `DetectorCamera` do not:
 * detectors and the models behind them are shared by every organization on the
 * instance, which is deliberate -- one inference process serves all tenants and
 * loading a second copy of the same YOLO weights per tenant would be untenable.
 *
 * The consequence is that a permission check alone is not enough on those
 * routes. `models.manage` is held by the tenant-level `admin` role, so without
 * this gate an admin in one organization could uninstall a detector another
 * organization's cameras depend on, disable the detection pipeline for the whole
 * instance, or rewrite the confidence threshold and alert cooldown that apply to
 * every tenant's cameras. `assignCameras` is deliberately not gated: it already
 * scopes its writes to the caller's own organization, and a tenant admin must
 * be able to point shared detectors at their own cameras.
 *
 * Reads are not gated. `models.read` is granted broadly and exposing the set of
 * installed detectors is not privileged information.
 */
export function requireInstanceAdmin(message: string): RequestHandler {
  const handler: RequestHandler = (req: AuthRequest, res, next) => {
    if (req.userRole !== SUPER_ADMIN_ROLE) {
      return res.status(403).json({
        success: false,
        message,
      });
    }
    next();
  };
  // Express derives a route layer's name from the handler's function name.
  // Setting it keeps the gate identifiable in the router stack, which is how
  // tests/detector-instance-scope.vitest.test.ts asserts that every instance-wide
  // mutation is actually gated, and keeps middleware readable in stack traces.
  Object.defineProperty(handler, "name", { value: "requireInstanceAdmin" });
  return handler;
}

/** Message used on every instance-wide detector/model mutation. */
export const INSTANCE_DETECTOR_MESSAGE =
  "Detectors and AI models are shared across all organizations on this instance and can only be changed by a Super Admin";

/** Shorter alias for routes that mutate the shared model surface. */
export const INSTANCE_MODEL_MESSAGE = INSTANCE_DETECTOR_MESSAGE;