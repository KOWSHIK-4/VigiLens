import { rateLimit, type RateLimitRequestHandler } from "express-rate-limit";
import type { NextFunction, Request, Response } from "express";
import { getSettingDefinition } from "../settings";
import { settingsService } from "./settings.service";

export interface ApiRateLimitTuning {
  /** Global API rate limit window, in milliseconds. */
  windowMs: number;
  /** Maximum requests per client inside the window. */
  max: number;
}

/**
 * Tuning that applies until Security settings are loaded at boot. Matches
 * the documented defaults for `rate_limit_window_ms` / `rate_limit_max_requests`.
 */
const FALLBACK_TUNING: ApiRateLimitTuning = { windowMs: 60_000, max: 300 };

function buildLimiter(tuning: ApiRateLimitTuning): RateLimitRequestHandler {
  return rateLimit({
    windowMs: tuning.windowMs,
    max: tuning.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, please try again later" },
  });
}

let currentTuning: ApiRateLimitTuning = { ...FALLBACK_TUNING };
let currentLimiter: RateLimitRequestHandler = buildLimiter(currentTuning);

function clamp(value: number, def: { min?: number; max?: number } | undefined): number {
  if (def?.min !== undefined && value < def.min) return def.min;
  if (def?.max !== undefined && value > def.max) return def.max;
  return value;
}

async function loadConfiguredTuning(): Promise<ApiRateLimitTuning> {
  const [windowMs, max] = await Promise.all([
    settingsService.getValue("security", "rate_limit_window_ms"),
    settingsService.getValue("security", "rate_limit_max_requests"),
  ]);

  const numericWindowMs = typeof windowMs === "number" ? windowMs : NaN;
  const numericMax = typeof max === "number" ? max : NaN;

  return {
    windowMs: clamp(
      Number.isFinite(numericWindowMs) ? numericWindowMs : FALLBACK_TUNING.windowMs,
      getSettingDefinition("security", "rate_limit_window_ms"),
    ),
    max: clamp(
      Number.isFinite(numericMax) ? numericMax : FALLBACK_TUNING.max,
      getSettingDefinition("security", "rate_limit_max_requests"),
    ),
  };
}

export const rateLimitService = {
  /** Currently active global API rate limit tuning (a fresh snapshot). */
  get(): ApiRateLimitTuning {
    return { ...currentTuning };
  },

  /**
   * Express middleware that delegates to the currently active limiter
   * instance. Swap-ready: `refresh()` replaces the backing limiter so tuning
   * changes take effect immediately without a restart.
   */
  middleware(req: Request, res: Response, next: NextFunction) {
    return currentLimiter(req, res, next);
  },

  /**
   * Reloads the tuning from the security settings and rebuilds the backing
   * limiter. Called at boot and after security settings change so operators
   * can retune live. If the settings cannot be read (DB unavailable), the
   * documented defaults are used.
   */
  async refresh(): Promise<void> {
    const next = await loadConfiguredTuning().catch(() => ({ ...FALLBACK_TUNING }));
    currentTuning = next;
    currentLimiter = buildLimiter(next);
  },
};