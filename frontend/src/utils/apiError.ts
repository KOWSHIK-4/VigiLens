import axios from "axios";

function extractString(value: unknown, depth = 0): string | undefined {
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Error) {
    return typeof value.message === "string" && value.message.length > 0
      ? value.message
      : extractString((value as { message?: unknown }).message, depth + 1);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractString(item, depth + 1))
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "errorMessage", "description"] as const) {
      const candidate = obj[key];
      if (typeof candidate === "string") {
        if (candidate.length > 0) return candidate;
        continue;
      }
      // e.g. { error: { code:"X", message:"Y" } } or { message: [..,..] } ->
      // recurse into the nested value to pull out its human-readable text.
      if (depth < 5 && candidate !== null && typeof candidate === "object") {
        const nested = extractString(candidate, depth + 1);
        if (nested) return nested;
      }
    }
    // Zod/validation style "errors" arrays (or arrays nested under a key).
    const nested = obj.errors ?? obj.details;
    if (Array.isArray(nested)) {
      const parts = nested
        .map((item) => extractString(item, depth + 1))
        .filter((part): part is string => typeof part === "string" && part.length > 0);
      if (parts.length > 0) return parts.join(", ");
    }
    if (typeof obj.code === "string" && obj.code.length > 0) {
      return `Request failed (${obj.code})`;
    }
    try {
      const serialized = JSON.stringify(value);
      if (typeof serialized === "string" && serialized.length > 0) return serialized;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Convert any thrown value into a display-safe string. Never returns an
 * object, so it is always safe to pass to React children or to setError().
 *
 * - string        -> itself
 * - Error         -> its .message
 * - {code,message}-> the message field (also {error:...}, {detail:...})
 * - {error:{...}} -> the nested object's message/string repr
 * - arrays        -> joined string representation
 * - other objects -> safe JSON.stringify
 * - null/undefined/empty -> the provided fallback
 */
export function toErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  return extractString(err) ?? fallback;
}

/**
 * Extract a human-readable message from an API/axios error (or any error).
 * Prefers the response body's `error`/`message`/`detail` fields (the backend
 * envelope is { success:false, error, code, ... }), falls back to the request
 * failure reason, and always returns a plain string.
 */
export function getApiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const fromResponse = extractString(err.response?.data);
    if (fromResponse) return fromResponse;
    // err.response == null  -> network/CORS failure; err.message is the best hint.
    if (!err.response && typeof err.message === "string" && err.message.length > 0) {
      return err.message;
    }
    return fallback;
  }
  return extractString(err) ?? fallback;
}