import type { Response } from "express";
import { toApiErrorBody } from "./errors";

export function success(res: Response, data: unknown, statusCode = 200) {
  return res.status(statusCode).json({ success: true, data });
}

export function paginated(
  res: Response,
  data: unknown[],
  total: number,
  page: number,
  limit: number,
) {
  return res.status(200).json({
    success: true,
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

export function error(
  res: Response,
  message: string,
  statusCode = 500,
  options: { code?: string; details?: unknown } = {},
) {
  const req = res.req;
  const body = toApiErrorBody({
    statusCode,
    message,
    code: options.code,
    details: options.details,
    requestId: res.locals.requestId,
    endpoint: req?.originalUrl || req?.url,
    method: req?.method,
  });
  return res.status(statusCode).json(body);
}
