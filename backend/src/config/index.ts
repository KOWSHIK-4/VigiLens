import "dotenv/config";

const INSECURE_DEFAULTS = [
  { key: "JWT_SECRET", value: process.env.JWT_SECRET, insecure: "dev-secret-change-in-production" },
  { key: "INTERNAL_API_KEY", value: process.env.INTERNAL_API_KEY, insecure: "dev-internal-key-change-in-production" },
] as const;

const INSECURE_DB_PASSWORDS = ["vigilens_secret", "postgres", "password", "admin"];

if (process.env.NODE_ENV === "production") {
  const failures: string[] = [];
  for (const { key, value, insecure } of INSECURE_DEFAULTS) {
    if (!value || value === insecure) {
      failures.push(key);
    }
  }

  const dbUrl = process.env.DATABASE_URL || "";
  const dbPasswordMatch = dbUrl.match(/:\/\/[^:]+:([^@]+)@/);
  if (dbPasswordMatch) {
    const dbPassword = dbPasswordMatch[1];
    if (INSECURE_DB_PASSWORDS.includes(dbPassword)) {
      failures.push("DATABASE_URL (contains default/weak password)");
    }
  } else if (!process.env.DATABASE_URL) {
    failures.push("DATABASE_URL (not set)");
  }

  if (failures.length > 0) {
    console.error(
      `[SECURITY] FATAL: Insecure defaults detected in production: ${failures.join(", ")}. ` +
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
