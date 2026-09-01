import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { prisma } from "./config/prisma";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import routes from "./routes";
import healthRoutes from "./routes/health.routes";
import { modelService } from "./services/model.service";
import { settingsService } from "./services/settings.service";
import { monitorScheduler } from "./engine/monitor";

const app = express();

if (config.nodeEnv === "production") {
  app.set("trust proxy", 1);
}

// Handle CORS preflight (OPTIONS) as the very first middleware so that no
// other middleware (helmet, body parser, rate limiter) can interfere with
// emitting the Access-Control-Allow-Origin header for allowed origins.
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.origin;
    if (origin && config.cors.origin.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Internal-Key",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    return res.sendStatus(204);
  }
  next();
});

app.use(helmet());

app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
  }),
);

app.use(express.json({ limit: "10mb" }));

app.use(
  rateLimit({
    // The dashboard polls several endpoints every few seconds, so the
    // global bucket must tolerate sustained UI traffic (~5 req/s per IP)
    // while still capping abuse. Credential endpoints carry their own
    // stricter limit in auth.routes.
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "Too many requests, please try again later" },
  }),
);

app.use(requestContext);

app.use("/health", healthRoutes);

app.use("/api", routes);

app.use(notFoundHandler);

app.use(errorHandler);

async function start() {
  try {
    await prisma.$connect();
    logger.info("Database connected");

    try {
      await modelService.syncRegisteredDetectors();
    } catch (error) {
      logger.error("Failed to sync AI model registry", { error });
    }

    try {
      await settingsService.ensureDefaults();
    } catch (error) {
      logger.error("Failed to seed default system settings", { error });
    }

    if (config.monitor.enabled) {
      monitorScheduler.start();
      logger.info("Continuous monitoring auto-started (MONITOR_ENABLED=true)");
    }

    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });

    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout = 66 * 1000;

    let shuttingDown = false;
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received, shutting down gracefully`);

      const forceExit = setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
      }, 10_000);
      forceExit.unref();

      server.close(async () => {
        try {
          monitorScheduler.stop();
          await prisma.$disconnect();
          logger.info("HTTP server and database connections closed");
          process.exit(0);
        } catch (error) {
          logger.error("Error during shutdown", { error });
          process.exit(1);
        }
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
});

export default app;

if (!process.env.VERCEL) {
  start();
}
