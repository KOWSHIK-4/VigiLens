import "module-alias/register";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "@/config";
import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import { errorHandler, notFoundHandler } from "@/middleware/errorHandler";
import { requestContext } from "@/middleware/requestContext";
import routes from "@/routes";
import healthRoutes from "@/routes/health.routes";
import { modelService } from "@/services/model.service";
import { settingsService } from "@/services/settings.service";

const app = express();

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
    windowMs: 15 * 60 * 1000,
    max: 100,
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

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

start();
