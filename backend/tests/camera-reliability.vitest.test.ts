import { describe, it, expect } from "vitest";
import {
  summarizeCameraReliability,
  type CameraFleetReliabilityRow,
} from "../src/services/cameraReliability";

const BASE = new Date("2026-09-18T12:00:00.000Z");

function row(
  overrides: Partial<CameraFleetReliabilityRow> = {},
): CameraFleetReliabilityRow {
  return {
    cameraId: "cam-1",
    status: "online",
    responseTime: 40,
    checkedAt: BASE,
    ...overrides,
  };
}

describe("summarizeCameraReliability", () => {
  it("withholds availability when the camera has no checks in the window", () => {
    const summary = summarizeCameraReliability(
      [row({ checkedAt: new Date(BASE.getTime() - 11 * 60_000) })],
      10 * 60_000,
      BASE,
    );
    expect(summary.healthyChecks).toBe(0);
    expect(summary.totalChecks).toBe(0);
    expect(summary.availabilityPct).toBeNull();
    expect(summary.avgResponseTimeMs).toBeNull();
    expect(summary.lastStatus).toBeNull();
    expect(summary.lastCheckedAt).toBeNull();
  });

  it("computes availability as the share of healthy checks inside the window", () => {
    const summary = summarizeCameraReliability(
      [
        row({ status: "online", responseTime: 30, checkedAt: BASE }),
        row({ status: "offline", responseTime: null, checkedAt: new Date(BASE.getTime() - 2 * 60_000) }),
      ],
      10 * 60_000,
      BASE,
    );
    expect(summary.healthyChecks).toBe(1);
    expect(summary.totalChecks).toBe(2);
    expect(summary.availabilityPct).toBe(50);
  });

  it("averages response time only across checks that have a value", () => {
    const summary = summarizeCameraReliability(
      [
        row({ responseTime: 30, checkedAt: BASE }),
        row({ responseTime: null, checkedAt: new Date(BASE.getTime() - 1 * 60_000) }),
        row({ responseTime: 50, checkedAt: new Date(BASE.getTime() - 3 * 60_000) }),
      ],
      10 * 60_000,
      BASE,
    );
    expect(summary.avgResponseTimeMs).toBe(40);
  });

  it("ignores negative and non-finite response-time samples", () => {
    const summary = summarizeCameraReliability(
      [
        row({ responseTime: 30, checkedAt: BASE }),
        row({ responseTime: -10, checkedAt: new Date(BASE.getTime() - 1_000) }),
        row({ responseTime: Number.NaN, checkedAt: new Date(BASE.getTime() - 2_000) }),
        row({ responseTime: Number.POSITIVE_INFINITY, checkedAt: new Date(BASE.getTime() - 3_000) }),
      ],
      10 * 60_000,
      BASE,
    );
    expect(summary.totalChecks).toBe(4);
    expect(summary.avgResponseTimeMs).toBe(30);
  });

  it("reports the most recent status and timestamp in the window", () => {
    const summary = summarizeCameraReliability(
      [
        row({ status: "offline", checkedAt: new Date(BASE.getTime() - 5 * 60_000) }),
        row({ status: "online", checkedAt: new Date(BASE.getTime() - 1 * 60_000) }),
      ],
      10 * 60_000,
      BASE,
    );
    expect(summary.lastStatus).toBe("online");
    expect(summary.lastCheckedAt).toBe(new Date(BASE.getTime() - 1 * 60_000).toISOString());
  });

  it("ignores checks recorded outside the rolling window", () => {
    const summary = summarizeCameraReliability(
      [
        row({ status: "online", responseTime: 40, checkedAt: new Date(BASE.getTime() - 11 * 60_000) }),
        row({ status: "offline", responseTime: null, checkedAt: new Date(BASE.getTime() + 1 * 60_000) }),
        row({ status: "online", responseTime: 20, checkedAt: BASE }),
      ],
      10 * 60_000,
      BASE,
    );
    expect(summary.totalChecks).toBe(1);
    expect(summary.healthyChecks).toBe(1);
  });

  it("includes checks exactly on both rolling-window boundaries", () => {
    const windowMs = 10 * 60_000;
    const summary = summarizeCameraReliability(
      [
        row({ checkedAt: new Date(BASE.getTime() - windowMs), responseTime: 0 }),
        row({ checkedAt: BASE, responseTime: 20 }),
      ],
      windowMs,
      BASE,
    );
    expect(summary.totalChecks).toBe(2);
    expect(summary.healthyChecks).toBe(2);
    expect(summary.avgResponseTimeMs).toBe(10);
    expect(summary.lastCheckedAt).toBe(BASE.toISOString());
  });

  it("finds the latest health check even when input rows are unordered", () => {
    const latest = new Date(BASE.getTime() - 30_000);
    const summary = summarizeCameraReliability(
      [
        row({ status: "online", checkedAt: latest }),
        row({ status: "offline", checkedAt: new Date(BASE.getTime() - 5 * 60_000) }),
        row({ status: "offline", checkedAt: new Date(BASE.getTime() - 2 * 60_000) }),
      ],
      10 * 60_000,
      BASE,
    );
    expect(summary.lastStatus).toBe("online");
    expect(summary.lastCheckedAt).toBe(latest.toISOString());
  });
});
