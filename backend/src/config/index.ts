import "dotenv/config";

const INSECURE_DEFAULTS = [
  { key: "JWT_SECRET", value: process.env.JWT_SECRET, insecure: "dev-secret-change-in-production" },
  { key: "INTERNAL_API_KEY", value: process.env.INTERNAL_API_KEY, insecure: "dev-internal-key-change-in-production" },
] as const;

if (process.env.NODE_ENV === "production") {
  const failures: string[] = [];
  for (const { key, value, insecure } of INSECURE_DEFAULTS) {
    if (!value || value === insecure) {
      failures.push(key);
    }
  }
  if (failures.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `[SECURITY] FATAL: Insecure secret defaults detected in production: ${failures.join(", ")}. ` +
      "Set unique values for each via environment variables. The server will not start with insecure defaults.",
    );
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
  },
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  },
  security: {
    /** Shared secret for machine-to-machine ingestion (AI service -> backend). */
    internalApiKey:
      process.env.INTERNAL_API_KEY || "dev-internal-key-change-in-production",
  },
  ai: {
    serviceUrl: process.env.AI_SERVICE_URL || "http://localhost:8000",
  },
  monitor: {
    enabled: process.env.MONITOR_ENABLED === "true",
    tickMs: parseInt(process.env.MONITOR_TICK_MS || "1000", 10),
  },
  log: {
    level: process.env.LOG_LEVEL || "info",
  },
};
