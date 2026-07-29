import winston from "winston";
import { config } from "./index";

export const logger = winston.createLogger({
  level: config.log.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.nodeEnv === "production"
      ? winston.format.json()
      : winston.format.prettyPrint(),
  ),
  defaultMeta: { service: "vigilens-api" },
  transports: [
    new winston.transports.Console({
      format:
        config.nodeEnv === "production"
          ? winston.format.json()
          : winston.format.combine(
              winston.format.colorize(),
              winston.format.simple(),
            ),
    }),
  ],
});
