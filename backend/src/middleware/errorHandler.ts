import type { Request, Response, NextFunction } from "express";
import { logger } from "../config/logger";
import { ApiError, toApiErrorBody } from "../utils/errors";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const requestId = (res.locals.requestId as string) || "unknown";
  const endpoint = req.originalUrl || req.url || "";
  const method = req.method;

  const isApiError = err instanceof ApiError;

  // body-parser surfaces malformed JSON as a SyntaxError with `status`;
  // that is a client problem (400), not a server fault.
  const errStatus = (err as { status?: unknown }).status;
  const isMalformedBody = err instanceof SyntaxError && errStatus === 400;

  const statusCode = isApiError
    ? err.statusCode
    : isMalformedBody
      ? 400
      : res.statusCode >= 400
        ? res.statusCode
        : 500;

  const message = isApiError
    ? err.message
    : isMalformedBody
      ? "Request body contains malformed JSON"
      : "Internal server error";

  logger.log(
    statusCode >= 500 ? "error" : "warn",
    "Request failed",
    {
      requestId,
      statusCode,
      endpoint,
      method,
      severity: statusCode >= 500 ? "error" : "warning",
      message: err.message,
      stack: statusCode >= 500 ? err.stack : undefined,
    },
  );

  const body = toApiErrorBody({
    statusCode,
    message,
    code: isApiError ? err.code : undefined,
    details: isApiError ? err.details : undefined,
    requestId,
    endpoint,
    method,
  });

  return res.status(statusCode).json(body);
}

export function notFoundHandler(req: Request, res: Response) {
  const requestId = (res.locals.requestId as string) || "unknown";
  const body = toApiErrorBody({
    statusCode: 404,
    message: "Route not found",
    requestId,
    endpoint: req.originalUrl || req.url,
    method: req.method,
  });
  return res.status(404).json(body);
}
