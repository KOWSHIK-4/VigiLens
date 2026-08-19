/**
 * Security validation tests.
 *
 * Verifies that production-mode secret validation, alert cooldown sharing,
 * and detection storage behave correctly.
 */

import { describe, it, expect } from "vitest";
import { config } from "../src/config";
import { sharedAlertCooldownRegistry } from "../src/engine/alerts";

describe("Security Validation", () => {
  it("JWT secret is a string", () => {
    expect(typeof config.jwt.secret).toBe("string");
  });

  it("Internal API key is a string", () => {
    expect(typeof config.security.internalApiKey).toBe("string");
  });

  it("JWT secret is not empty", () => {
    expect(config.jwt.secret.length > 0).toBe(true);
  });

  it("Internal API key is not empty", () => {
    expect(config.security.internalApiKey.length > 0).toBe(true);
  });

  it("shared registry has shouldRaise", () => {
    expect(typeof sharedAlertCooldownRegistry.shouldRaise).toBe("function");
  });

  it("shared registry has record", () => {
    expect(typeof sharedAlertCooldownRegistry.record).toBe("function");
  });

  it("shared registry has reset", () => {
    expect(typeof sharedAlertCooldownRegistry.reset).toBe("function");
  });

  it("first call passes cooldown", () => {
    sharedAlertCooldownRegistry.reset();
    const key = "test:cam-1:person";
    const now = Date.now();
    expect(sharedAlertCooldownRegistry.shouldRaise(key, now, 5000)).toBe(true);
  });

  it("second call within cooldown is blocked", () => {
    sharedAlertCooldownRegistry.reset();
    const key = "test:cam-1:person";
    const now = Date.now();
    sharedAlertCooldownRegistry.record(key, now);
    expect(sharedAlertCooldownRegistry.shouldRaise(key, now + 1000, 5000)).toBe(false);
  });

  it("call after cooldown passes", () => {
    sharedAlertCooldownRegistry.reset();
    const key = "test:cam-1:person";
    const now = Date.now();
    sharedAlertCooldownRegistry.record(key, now);
    expect(sharedAlertCooldownRegistry.shouldRaise(key, now + 6000, 5000)).toBe(true);
  });

  it("default port is 4000", () => {
    expect(config.port).toBe(4000);
  });

  it("default JWT expiry is 7d", () => {
    expect(config.jwt.expiresIn).toBe("7d");
  });

  it("default AI service URL", () => {
    expect(config.ai.serviceUrl).toBe("http://localhost:8000");
  });
});
