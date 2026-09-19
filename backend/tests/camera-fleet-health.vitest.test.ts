/**
 * Camera fleet health — pure unit tests for the fleet aggregation. Per-camera
 * reliability itself is already covered by `camera-reliability.vitest.test.ts`.
 *
 * Pins: weighted availability, honest "unknown" when no checks exist, fleet
 * status derivation and worst-first ordering.
 */

import { describe, expect, it } from "vitest";
import {
  clampWindow,
  FLEET_HEALTH_DEFAULT_WINDOW_MS,
  FLEET_HEALTH_MAX_WINDOW_MS,
  summarizeFleetHealth,
  type CameraFleetHealth,
} from "../src/services/cameraFleetHealth.service";
import type { CameraReliability } from "../src/services/cameraReliability";

const CHECKS = 24 * 60 * 60 * 1000;

function cam(
  id: string,
  name: string,
  rel: Partial<CameraReliability>,
): CameraFleetHealth {
  return {
    cameraId: id,
    name,
    location: null,
    status: rel.lastStatus ?? "online",
    reliability: {
      healthyChecks: 0,
      totalChecks: 0,
      availabilityPct: null,
      avgResponseTimeMs: null,
      lastStatus: null,
      lastCheckedAt: null,
      ...rel,
    },
  };
}

describe("summarizeFleetHealth", () => {
  it("reports unknown when no camera has checks in the window", () => {
    const summary = summarizeFleetHealth(
      [cam("a", "A", {}), cam("b", "B", {})],
      CHECKS,
    );
    expect(summary.fleetStatus).toBe("unknown");
    expect(summary.fleetAvailabilityPct).toBeNull();
    expect(summary.totalChecks).toBe(0);
    expect(summary.reason).toContain("No camera has a health check");
  });

  it("computes a check-weighted fleet availability", () => {
    const summary = summarizeFleetHealth(
      [
        cam("a", "A", { healthyChecks: 10, totalChecks: 10, availabilityPct: 100, lastStatus: "online" }),
        cam("b", "B", { healthyChecks: 5, totalChecks: 10, availabilityPct: 50, lastStatus: "online" }),
      ],
      CHECKS,
    );
    expect(summary.totalChecks).toBe(20);
    expect(summary.totalHealthyChecks).toBe(15);
    expect(summary.fleetAvailabilityPct).toBe(75);
  });

  it("sorts cameras by worst-first availability", () => {
    const summary = summarizeFleetHealth(
      [
        cam("a", "A", { healthyChecks: 10, totalChecks: 10, availabilityPct: 100, lastStatus: "online" }),
        cam("b", "B", { healthyChecks: 2, totalChecks: 10, availabilityPct: 20, lastStatus: "offline" }),
        cam("c", "C", { healthyChecks: 0, totalChecks: 0, availabilityPct: null, lastStatus: null }),
      ],
      CHECKS,
    );
    expect(summary.cameras.map((c) => c.cameraId)).toEqual(["b", "a", "c"]);
  });

  it("declares a healthy fleet when no camera is degraded or offline", () => {
    const summary = summarizeFleetHealth(
      [
        cam("a", "A", { healthyChecks: 8, totalChecks: 8, availabilityPct: 100, lastStatus: "online" }),
        cam("b", "B", { healthyChecks: 3, totalChecks: 3, availabilityPct: 100, lastStatus: "online" }),
      ],
      CHECKS,
    );
    expect(summary.fleetStatus).toBe("healthy");
    expect(summary.offlineCameras).toBe(0);
    expect(summary.degradedCameras).toBe(0);
  });

  it("down-grades to at_risk when multiple cameras are unhealthy", () => {
    const summary = summarizeFleetHealth(
      [
        cam("a", "A", { healthyChecks: 0, totalChecks: 10, availabilityPct: 0, lastStatus: "offline" }),
        cam("b", "B", { healthyChecks: 4, totalChecks: 10, availabilityPct: 40, lastStatus: "online" }),
      ],
      CHECKS,
    );
    expect(summary.fleetStatus).toBe("at_risk");
    expect(summary.offlineCameras).toBe(1);
    expect(summary.degradedCameras).toBe(2);
  });

  it("reports online share from the most recent in-window status", () => {
    const summary = summarizeFleetHealth(
      [
        cam("a", "A", { healthyChecks: 8, totalChecks: 8, availabilityPct: 100, lastStatus: "online" }),
        cam("b", "B", { healthyChecks: 2, totalChecks: 10, availabilityPct: 20, lastStatus: "offline" }),
      ],
      CHECKS,
    );
    expect(summary.onlineSharePct).toBe(50);
  });
});

describe("clampWindow", () => {
  it("bounds the window to the configured ceiling", () => {
    expect(clampWindow(FLEET_HEALTH_MAX_WINDOW_MS + 1)).toBe(FLEET_HEALTH_MAX_WINDOW_MS);
    expect(clampWindow(FLEET_HEALTH_DEFAULT_WINDOW_MS)).toBe(FLEET_HEALTH_DEFAULT_WINDOW_MS);
  });

  it("rejects invalid windows", () => {
    expect(() => clampWindow(0)).toThrow();
    expect(() => clampWindow(Number.NaN)).toThrow();
  });
})