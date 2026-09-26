import "dotenv/config";

const INSECURE_DEFAULTS = [
  { key: "JWT_SECRET", value: process.env.JWT_SECRET, insecure: "dev-secret-change-in-production" },
  { key: "INTERNAL_API_KEY", value: process.env.INTERNAL_API_KEY, insecure: "dev-internal-key-change-in-production" },
] as const;

const INSECURE_DB_PASSWORDS = ["vigilens_secret", "postgres", "password", "admin"];

/**
 * Placeholder markers that are never acceptable as signing/Crypto material,
 * even when they differ from the exact dev-default strings (e.g.
 * "change_me_in_production" or "CHANGEME").
 */
const PLACEHOLDER_PATTERN =
  /(change[_-]?me|changeme|your[_-]?(secret|key)|example[_-]?(secret|key)|s3cret|replace[_-]?me|dummy[_-]?(secret|key)|xxx+)/i;

/** Minimum length for HMAC signing keys / shared boundaries (~256-bit). */
const MIN_SECRET_LENGTH = 32;

export function isInsecureSecretValue(value: string | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (trimmed.length < MIN_SECRET_LENGTH) return true;
  return PLACEHOLDER_PATTERN.test(trimmed);
}

export function hasWeakDatabasePassword(dbUrl: string | undefined): string | null {
  if (!dbUrl) return "DATABASE_URL (not set)";
  const match = dbUrl.match(/:\/\/[^:]+:([^@]+)@/);
  if (match && INSECURE_DB_PASSWORDS.includes(match[1])) {
    return "DATABASE_URL (contains default/weak password)";
  }
  return null;
}

export function insecureProductionSecrets(): string[] {
  const failures: string[] = [];
  for (const { key, value, insecure } of INSECURE_DEFAULTS) {
    if (!value || value === insecure || isInsecureSecretValue(value)) {
      failures.push(key);
    }
  }
  const dbFailure = hasWeakDatabasePassword(process.env.DATABASE_URL);
  if (dbFailure) failures.push(dbFailure);
  if (!process.env.CAMERA_CREDENTIALS_KEY || isInsecureSecretValue(process.env.CAMERA_CREDENTIALS_KEY)) {
    failures.push("CAMERA_CREDENTIALS_KEY (not set or insecure)");
  }
  return failures;
}

export function parseCorsOrigins(raw: string | undefined, fallback: string[]): string[] {
  if (!raw || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

if (process.env.NODE_ENV === "production") {
  const failures = insecureProductionSecrets();

  if (failures.length > 0) {
    const msg =
      `[SECURITY] Insecure defaults detected in production: ${failures.join(", ")}. ` +
      "Set unique values for each via environment variables.";
    // Signing/crypto material is never safe to run with a placeholder even on
    // Vercel: a predictable JWT secret or internal key defeats the purpose of
    // the platform's hardcoded environment wiring.
    console.error(`FATAL: ${msg} The server will not start with insecure defaults.`);
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  database: {
    url: process.env.DATABASE_URL || "postgresql://vigilens:vigilens_secret@localhost:5432/vigilens",
  },
  jwt: {
    secret: process.env.JWT_SECRET || "dev-secret-change-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    issuer: process.env.JWT_ISSUER || "vigilens-api",
    audience: process.env.JWT_AUDIENCE || "vigilens-frontend",
  },
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGIN, [
      "https://vigilens-rho.vercel.app",
      "https://vigilens.vercel.app",
      "http://localhost:5173",
    ]),
  },
  security: {
    /** Shared secret for machine-to-machine ingestion (AI service -> backend). */
    internalApiKey:
      process.env.INTERNAL_API_KEY || "dev-internal-key-change-in-production",
  },
  ai: {
    serviceUrl: process.env.AI_SERVICE_URL || "http://localhost:8000",
    /**
     * True only when the deployment explicitly declared an AI service.
     *
     * An unset `AI_SERVICE_URL` falls back to the localhost default, which
     * can never resolve on a serverless platform. Health reporting uses this
     * flag to report the AI service as `not_configured` instead of probing a
     * guaranteed-dead address and reporting a false `offline`, so a
     * deployment that intentionally ships without live inference does not
     * hold its readiness gate permanently red.
     */
    configured: Boolean(process.env.AI_SERVICE_URL?.trim()),
  },
  monitor: {
    enabled: process.env.MONITOR_ENABLED === "true",
    tickMs: parseInt(process.env.MONITOR_TICK_MS || "1000", 10),
  },
  retention: {
    enabled: process.env.RETENTION_ENABLED !== "false",
    tickMs: parseInt(process.env.RETENTION_TICK_MS || "60000", 10),
  },
  log: {
    level: process.env.LOG_LEVEL || "info",
  },
};
