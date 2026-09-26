import { describe, it, expect, afterEach, vi } from "vitest";
import { overallStatus, type ServiceHealth } from "../src/services/health.service";

/**
 * Loads a fresh copy of the config module with AI_SERVICE_URL forced to a
 * specific value, so the "declared vs not declared" distinction can be
 * exercised without mutating process.env for the rest of the suite.
 */
async function loadConfigWithAiServiceUrl(value: string | undefined) {
  const key = "AI_SERVICE_URL";
  const previous = process.env[key];
  vi.resetModules();
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;

  try {
    const mod = await import("../src/config");
    return mod.config.ai;
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
}

describe("AI service configuration", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("keeps the localhost fallback for serviceUrl when undeclared", async () => {
    const ai = await loadConfigWithAiServiceUrl(undefined);
    expect(ai.serviceUrl).toBe("http://localhost:8000");
  });

  it("marks the AI service unconfigured when AI_SERVICE_URL is unset", async () => {
    const ai = await loadConfigWithAiServiceUrl(undefined);
    expect(ai.configured).toBe(false);
  });

  it("marks the AI service unconfigured when AI_SERVICE_URL is blank", async () => {
    const ai = await loadConfigWithAiServiceUrl("   ");
    expect(ai.configured).toBe(false);
  });

  it("marks the AI service configured when AI_SERVICE_URL is declared", async () => {
    const ai = await loadConfigWithAiServiceUrl("https://ai.internal:8000");
    expect(ai.configured).toBe(true);
    expect(ai.serviceUrl).toBe("https://ai.internal:8000");
  });
});

describe("readiness aggregation with an unconfigured AI service", () => {
  const aiNotConfigured: ServiceHealth = {
    name: "ai",
    label: "AI Service",
    status: "not_configured",
    responseTimeMs: 0,
    lastChecked: "2026-09-26T10:00:00.000Z",
    detail: "AI_SERVICE_URL is not set; live inference is not available in this deployment",
  };

  const databaseHealthy: ServiceHealth = {
    name: "postgres",
    label: "PostgreSQL",
    status: "healthy",
    responseTimeMs: 3,
    lastChecked: "2026-09-26T10:00:00.000Z",
  };

  it("does not hold the readiness gate red when AI is not deployed", () => {
    expect(overallStatus([databaseHealthy, aiNotConfigured])).toBe("healthy");
  });

  it("still reports unhealthy when a required service is offline", () => {
    const databaseOffline: ServiceHealth = { ...databaseHealthy, status: "offline" };
    expect(overallStatus([databaseOffline, aiNotConfigured])).toBe("unhealthy");
  });

  it("still reports degraded when a required service is degraded", () => {
    const storageDegraded: ServiceHealth = {
      ...databaseHealthy,
      name: "storage",
      label: "Storage",
      status: "degraded",
    };
    expect(overallStatus([databaseHealthy, storageDegraded, aiNotConfigured])).toBe("degraded");
  });
});
