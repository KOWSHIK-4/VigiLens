import { timingSafeEqual } from "node:crypto";
import type { Response, NextFunction } from "express";
import type { Request } from "express";
import { config } from "../config";
import { error as apiError } from "../utils/apiResponse";

/**
 * Length-safe constant-time string comparison. A plain `===` leaks the
 * position and length of the first differing byte through timing, which
 * is exploitable when the caller controls the candidate key.
 */
function keysMatch(expected: string, provided: string): boolean {
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) {
    // Compare anyway so mismatched lengths cost the same time.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

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

  if (!key || !keysMatch(config.security.internalApiKey, key)) {
    return apiError(res, "Invalid or missing internal API key", 401, {
      code: "INVALID_INTERNAL_KEY",
    });
  }
  res.locals.internal = true;
  next();
}
