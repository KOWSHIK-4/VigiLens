export type ErrorSeverity = "info" | "warning" | "error" | "critical";

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;

  constructor(
    statusCode: number,
    message: string,
    options: { code?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = options.code;
    this.details = options.details;
  }
}

export function severityForStatus(statusCode: number): ErrorSeverity {
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "warning";
  return "info";
}

export interface ApiErrorBody {
  success: false;
  error: string;
  code?: string;
  details?: unknown;
  requestId: string;
  severity: ErrorSeverity;
  statusCode: number;
  timestamp: string;
  endpoint: string;
  method: string;
}

export function toApiErrorBody(params: {
  statusCode: number;
  message: string;
  code?: string;
  details?: unknown;
  requestId?: string;
  endpoint?: string;
  method?: string;
}): ApiErrorBody {
  const body: ApiErrorBody = {
    success: false,
    error: params.message,
    requestId: params.requestId || "unknown",
    severity: severityForStatus(params.statusCode),
    statusCode: params.statusCode,
    timestamp: new Date().toISOString(),
    endpoint: params.endpoint || "",
    method: params.method || "",
  };
  if (params.code) body.code = params.code;
  if (params.details !== undefined) body.details = params.details;
  return body;
}
