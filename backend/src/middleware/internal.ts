import type { Response, NextFunction } from "express";
import type { Request } from "express";
import { config } from "@/config";
import { error as apiError } from "@/utils/apiResponse";

/**
 * Guards backend-internal, machine-to-machine endpoints (for example the
 * AI service posting detections). These endpoints must never be reachable
 * with only a browser session or anonymously, so they require a shared
 * secret sent in the `X-Internal-Key` header.
 *
 * The key travels out-of-band (environment / secrets), not through the
 * user token system, and is rejected with a 401 when missing or wrong.
 */
export function requireInternalKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers["x-internal-key"];
  const key = typeof header === "string" ? header : undefined;

  if (!key || key !== config.security.internalApiKey) {
    return apiError(res, "Invalid or missing internal API key", 401, {
      code: "INVALID_INTERNAL_KEY",
    });
  }
  res.locals.internal = true;
  next();
}
