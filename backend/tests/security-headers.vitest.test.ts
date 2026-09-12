import { describe, it, expect } from "vitest";
import { parseCorsOrigins } from "../src/config";
import { permissionsPolicyHeader, securityOptions } from "../src/middleware/securityHeaders";

describe("Security headers configuration", () => {
  it("enables a strict Content-Security-Policy for a JSON-only API", () => {
    const directives = securityOptions.contentSecurityPolicy?.directives ?? {};
    expect(directives.defaultSrc).toEqual(["'none'"]);
    expect(directives.frameAncestors).toEqual(["'none'"]);
    expect(directives.objectSrc).toEqual(["'none'"]);
  });

  it("configures HSTS with subdomains and preload for TLS deployments", () => {
    const hsts = securityOptions.hsts ?? {};
    expect(hsts.includeSubDomains).toBe(true);
    expect(hsts.preload).toBe(true);
    expect(typeof hsts.maxAge).toBe("number");
  });

  it("restricts referrer and browser feature policies", () => {
    expect(securityOptions.referrerPolicy).toEqual({ policy: "no-referrer" });
    expect(permissionsPolicyHeader).toContain("geolocation=()");
    expect(permissionsPolicyHeader).toContain("microphone=()");
    expect(permissionsPolicyHeader).toContain("payment=()");
  });

  it("denies framing and keeps xss filters legacy-disabled", () => {
    expect(securityOptions.frameguard).toEqual({ action: "deny" });
    expect(securityOptions.xssFilter).toBe(false);
  });
});

describe("parseCorsOrigins", () => {
  const fallback = ["https://viglens-rho.vercel.app", "http://localhost:5173"];

  it("falls back when the env var is unset or blank", () => {
    expect(parseCorsOrigins(undefined, fallback)).toEqual(fallback);
    expect(parseCorsOrigins("   ", fallback)).toEqual(fallback);
  });

  it("parses a comma-separated allowlist and trims entries", () => {
    expect(
      parseCorsOrigins("https://a.example.com, http://localhost:5173 ,https://b.example.com", fallback),
    ).toEqual(["https://a.example.com", "http://localhost:5173", "https://b.example.com"]);
  });
});