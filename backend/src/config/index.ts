import "dotenv/config";

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
