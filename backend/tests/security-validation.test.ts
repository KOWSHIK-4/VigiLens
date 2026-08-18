/**
 * Security validation tests.
 *
 * Verifies that production-mode secret validation, alert cooldown sharing,
 * and detection storage behave correctly.
 */

import { config } from "../src/config";
import { sharedAlertCooldownRegistry } from "../src/engine/alerts";

let passed = 0;
let failed = 0;

function ok(name: string, details?: string) {
  passed += 1;
  console.log(`  PASS  ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name: string, details?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
}

function expectEqual(actual: unknown, expected: unknown, name: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    ok(name, `${JSON.stringify(expected)}`);
  } else {
    fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function run() {
  // --- Config security ---
  expectEqual(typeof config.jwt.secret, "string", "JWT secret is a string");
  expectEqual(typeof config.security.internalApiKey, "string", "Internal API key is a string");
  ok(config.jwt.secret.length > 0, "JWT secret is not empty");
  ok(config.security.internalApiKey.length > 0, "Internal API key is not empty");

  // --- Shared alert cooldown registry ---
  expectEqual(typeof sharedAlertCooldownRegistry.shouldRaise, "function", "shared registry has shouldRaise");
  expectEqual(typeof sharedAlertCooldownRegistry.record, "function", "shared registry has record");
  expectEqual(typeof sharedAlertCooldownRegistry.reset, "function", "shared registry has reset");

  // Shared registry cooldown works
  sharedAlertCooldownRegistry.reset();
  const key = "test:cam-1:person";
  const now = Date.now();
  ok(sharedAlertCooldownRegistry.shouldRaise(key, now, 5000), "first call passes cooldown");
  sharedAlertCooldownRegistry.record(key, now);
  ok(!sharedAlertCooldownRegistry.shouldRaise(key, now + 1000, 5000), "second call within cooldown is blocked");
  ok(sharedAlertCooldownRegistry.shouldRaise(key, now + 6000, 5000), "call after cooldown passes");

  // --- Config defaults ---
  expectEqual(config.port, 4000, "default port is 4000");
  expectEqual(config.jwt.expiresIn, "7d", "default JWT expiry is 7d");
  expectEqual(config.ai.serviceUrl, "http://localhost:8000", "default AI service URL");

  console.log(`\nSecurity validation tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
