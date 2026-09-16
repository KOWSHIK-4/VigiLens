import helmet, { type HelmetOptions } from "helmet";
import type { RequestHandler } from "express";

/**
 * Explicitly configured security headers for the VigiLens API.
 *
 * The backend only serves JSON, SSE and small binary camera snapshots, so the
 * Content-Security-Policy can be maximally restrictive (`default-src 'none'`).
 * Policies are tuned to the deployment shape: the SPA is served from a
 * separate origin (Vercel/nginx) and talks to the API via CORS-mode requests,
 * which cross-origin resource policy does not affect.
 */
export const securityOptions: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 15552000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: { policy: "no-referrer" },
  crossOriginResourcePolicy: { policy: "same-origin" },
  frameguard: { action: "deny" },
  // The legacy X-XSS-Protection header is deprecated; modern browsers rely on
  // the CSP above. Helmet v8 disables it by default and we keep that.
  xssFilter: false,
  originAgentCluster: true,
};

// Helmet v8 no longer ships a Permissions-Policy middleware, so we set the
// header directly. Geopy/location, microphone, payment and USB capability
// are disabled for every origin.
export const permissionsPolicyHeader = "geolocation=(), microphone=(), payment=(), usb=()";

export function securityHeaders(): RequestHandler {
  const hardened = helmet(securityOptions);
  return (req, res, next) => {
    hardened(req, res, (err?: unknown) => {
      if (err) return next(err);
      res.setHeader("Permissions-Policy", permissionsPolicyHeader);
      next();
    });
  };
}

/**
 * Prevents browsers and shared caches from storing sensitive API responses.
 * VigiLens answers carry JWTs, user/role data, security dashboards and live
 * camera frames — none of which should ever be satisfied from cache. The
 * header is applied to every response (JSON, SSE and snapshot binaries) since
 * the API has no publicly cacheable endpoints.
 */
export function cacheControlNoStore(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  };
}