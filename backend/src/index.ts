import express from "express";
import cors from "cors";
import compression from "compression";
import { config } from "./config";
import { prisma } from "./config/prisma";
import { logger } from "./config/logger";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestContext } from "./middleware/requestContext";
import { securityHeaders, cacheControlNoStore } from "./middleware/securityHeaders";
import routes from "./routes";
import healthRoutes from "./routes/health.routes";
import { modelService } from "./services/model.service";
import { settingsService } from "./services/settings.service";
import { rateLimitService } from "./services/rateLimit.service";
import { monitorScheduler } from "./engine/monitor";
import { retentionScheduler } from "./services/retentionScheduler";

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
      // Allowlisted origin: emit the full CORS preflight response. This
      // path runs ahead of the cors() middleware below so that nothing else
      // (helmet, body parser, rate limiter) can interfere with the response.
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
      res.header(
        "Access-Control-Allow-Headers",
        req.headers["access-control-request-headers"] || "Content-Type, Authorization, X-Internal-Key",
      );
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Max-Age", "86400");
      return res.sendStatus(204);
    }
    // Third-party origin (or no Origin at all): answer the preflight with a
    // bare 204 and NO CORS headers. The browser requires Access-Control-
    // Allow-Origin to proceed, and leaking Allow-Methods/Allow-Headers/
    // Allow-Credentials to disallowed origins would hand out a CORS
    // capability map for free. (The cors() middleware stays mounted for the
    // simple non-OPTIONS requests where allowlist enforcement matters.)
    res.header("Vary", "Origin");
    return res.sendStatus(204);
  }
  next();
});

app.use(securityHeaders());
app.use(cacheControlNoStore());

app.use(
  cors({
    origin: config.cors.origin,
    credentials: true,
  }),
);

// JSON bodies for this API are small; image bytes are handled by multer on
// the engine upload routes, so a cap well above the largest legit JSON payload
// still hardens the body parser against oversized request abuse.
app.use(express.json({ limit: "2mb" }));

// Global API limiter. Its window/max come from the Security settings
// (rate_limit_window_ms / rate_limit_max_requests) and can be retuned in
// the admin Settings panel without a restart. Credential endpoints carry
// their own stricter limit (see auth.routes).
app.use(rateLimitService.middleware);

app.use(requestContext);

// Compress API responses end-to-end. The SSE stream is excluded explicitly:
// EventSource consumers would have no way to negotiate the encoding the way
// a fetch/XMLHttpRequest caller does, so streaming must stay identity-encoded.
app.use(
  compression({
    filter: (req, res) => {
      const contentType = res.getHeader("Content-Type");
      if (typeof contentType === "string" && contentType.startsWith("text/event-stream")) {
        return false;
      }
      return compression.filter(req, res);
    },
  }),
);

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

    await rateLimitService.refresh();
    logger.info("Global API rate limit tuning applied", rateLimitService.get());

    if (config.monitor.enabled) {
      monitorScheduler.start();
      logger.info("Continuous monitoring auto-started (MONITOR_ENABLED=true)");
    }

    if (config.retention.enabled) {
      retentionScheduler.start();
      logger.info("Automated data retention auto-started (RETENTION_ENABLED=true)");
    }

    const server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });

    // Turn an HTTP listen failure (EADDRINUSE, EACCES, ...) into a clean,
    // diagnosed exit instead of Node's raw unhandled "error" crash. The
    // process supervisor / restart policy decides whether to bring the
    // service back, which is the correct recovery boundary.
    server.on("error", (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      logger.error("HTTP server listen failed", { code, message: err.message, port: config.port });
      process.exit(1);
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
        server.closeAllConnections?.();
        process.exit(1);
      }, 10_000);
      forceExit.unref();

      // Stop accepting new connections, then drop idle keep-alive sockets so
      // the graceful drain completes promptly (Node's default keep-alive is
      // 65s here, which exceeds the force-exit budget). Requests that are
      // still in flight are allowed to finish before the server closes.
      server.close(async () => {
        try {
          monitorScheduler.stop();
          retentionScheduler.stop();
          await prisma.$disconnect();
          logger.info("HTTP server and database connections closed");
          process.exit(0);
        } catch (error) {
          logger.error("Error during shutdown", { error });
          process.exit(1);
        }
      });
      server.closeIdleConnections?.();
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
