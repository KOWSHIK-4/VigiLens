import winston from "winston";
import TransportStream from "winston-transport";
import { config } from "./index";

export interface LogBufferEntry {
  level: string;
  message: string;
  timestamp?: string;
  meta: Record<string, unknown>;
}

const LOG_BUFFER_MAX = 500;
const logBuffer: LogBufferEntry[] = [];

class LogBufferTransport extends TransportStream {
  log(info: Record<string, unknown>, callback: () => void): void {
    const level = typeof info.level === "string" ? info.level : "info";
    const message = typeof info.message === "string" ? info.message : "";
    const timestamp = typeof info.timestamp === "string" ? info.timestamp : undefined;
    const meta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(info)) {
      if (key === "level" || key === "message" || key === "timestamp") continue;
      meta[key] = value;
    }
    logBuffer.unshift({ level, message, timestamp, meta });
    if (logBuffer.length > LOG_BUFFER_MAX) {
      logBuffer.length = LOG_BUFFER_MAX;
    }
    callback();
  }
}

/**
 * Most recent log entries, newest first. Backs GET /api/system/logs so
 * operators can tail application logs without direct log-file access.
 */
export function getRecentLogs(limit = 100): LogBufferEntry[] {
  const safeLimit = Math.max(1, Math.min(limit, LOG_BUFFER_MAX));
  return logBuffer.slice(0, safeLimit);
}

/** Test hook: clears the in-memory ring buffer. */
export function clearLogBuffer(): void {
  logBuffer.length = 0;
}

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
    new LogBufferTransport(),
  ],
});
