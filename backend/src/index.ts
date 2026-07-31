import "module-alias/register";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "@/config";
import { prisma } from "@/config/prisma";
import { logger } from "@/config/logger";
import { errorHandler } from "@/middleware/errorHandler";
import routes from "@/routes";
import { modelService } from "@/services/model.service";

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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api", routes);

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

    app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
    });
  } catch (error) {
    logger.error("Failed to start server", { error });
    process.exit(1);
  }
}

start();
