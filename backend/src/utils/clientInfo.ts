import type { Request } from "express";

/**
 * Derives the audit-worthy client address for a request.
 *
 * The obvious implementation -- `req.headers["x-forwarded-for"]` -- is wrong.
 * That header is a client-supplied string: any caller can send
 * `X-Forwarded-For: 10.0.0.1` and have it recorded against their action, which
 * poisons exactly the field an incident responder trusts when reconstructing
 * who did something. The header is only meaningful when a trusted proxy in
 * front of the API asserts it.
 *
 * `req.ip` is the proxy-aware answer. Express resolves it through the
 * `trust proxy` setting (enabled in production, see `index.ts`), so it yields
 * the address of the last hop we actually trust, and the socket address when
 * the request did not arrive through a proxy at all -- never a value the
 * client chose. The socket address stays as an explicit fallback for handlers
 * invoked with a partial request object (internal ingestion, tests).
 *
 * Every audit write should use this so IP attribution is derived one way.
 */
export function clientIp(req: Request): string {
  if (typeof req.ip === "string" && req.ip) return req.ip;
  return req.socket?.remoteAddress || "";
}

/** The user agent recorded alongside the client address in audit rows. */
export function clientUserAgent(req: Request): string {
  const header = req.headers["user-agent"];
  return typeof header === "string" ? header : "";
}

/** The `ipAddress` / `userAgent` pair accepted by `logAudit`. */
export function clientInfo(req: Request): { ipAddress: string; userAgent: string } {
  return { ipAddress: clientIp(req), userAgent: clientUserAgent(req) };
}
