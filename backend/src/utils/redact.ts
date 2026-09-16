/**
 * Secret redaction helpers.
 *
 * Applied at the boundaries where sensitive material could otherwise escape:
 *  - the in-memory log buffer (served back via GET /api/system/logs),
 *  - error handler messages/stacks,
 *  - camera URLs returned through API payloads,
 *  - AI capture error detail strings.
 *
 * The redaction is deliberately conservative: it only rewrites well-known
 * secret shapes (URL userinfo, DSN passwords, auth header values) and never
 * claims to be an exhaustive DLP filter.
 */

/** `scheme://user:pass@` inside a string (DSN or stream URLs). */
const USERINFO_PATTERN = /(:\/\/[^:/\s@]+:)([^@/\s]+)(@)/g;

/** `user@` with no explicit password (rtsp://user@host). */
const USER_ONLY_PATTERN = /(\w+:\/\/)([^/@\s]+@)/gi;

/** `key=value` / `key: value` lines for credential-style attributes. */
const AUTH_HEADER_PATTERN =
  /(authorization|proxy-authorization|cookie|x-api-key|x-internal-key|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi;

/** Object keys that always carry secret material when present. */
export const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|authorization|credential|cookie)/i;

/** Constant used both as the log redaction marker and the settings mask. */
export const REDACTED = "[REDACTED]";

export const SECRET_MASK = "********";

/** Strips `user:pass@` / `user@` userinfo from URL-bearing strings. */
export function redactString(value: string): string {
  if (!value) return value;
  let out = value.replace(USERINFO_PATTERN, "$1***$3");
  out = out.replace(USER_ONLY_PATTERN, "$1***@");
  out = out.replace(AUTH_HEADER_PATTERN, (match, key) => `${key} ${REDACTED}`);
  return out;
}

/**
 * Recursively redacts a log payload: string values are scanned for embedded
 * secrets (URL userinfo, DSN passwords, auth header values) and object keys
 * that look like secret material are masked outright.
 */
export function redactSecrets(value: string): string;
export function redactSecrets(value: unknown, seen?: WeakSet<object>): unknown;
export function redactSecrets(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value;
  }
  if (typeof value !== "object") return value;

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value)) return value;
  visited.add(value);

  if (value instanceof Error) {
    value.message = redactString(value.message);
    if (value.stack) value.stack = redactString(value.stack);
    return value;
  }

  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer) return value;
  if (value instanceof Date || value instanceof RegExp) return value;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = redactSecrets(value[i], visited);
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const child = record[key];
    if (SENSITIVE_KEY_PATTERN.test(key) && typeof child === "string") {
      record[key] = REDACTED;
      continue;
    }
    record[key] = redactSecrets(child, visited);
  }
  return value;
}

/** Strips userinfo from a camera source URL while preserving the feed. */
export function stripUrlUserinfo(value: string): string {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    return url.toString();
  } catch {
    // Not a fully qualified URL (device path, relative path, video index).
    return value;
  }
}