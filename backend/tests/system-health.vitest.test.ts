import { describe, it, expect } from "vitest";
import { CameraType } from "@prisma/client";
import {
  overallStatus,
  type ServiceHealth,
  type ServiceStatus,
} from "../src/services/health.service";
import {
  toEngineSummary,
  toSchedulerLoopSummary,
  toSchedulerSummary,
} from "../src/services/system.service";
import type { MonitorLoop, MonitorStatus } from "../src/engine/monitor";

function service(status: ServiceStatus): ServiceHealth {
  return {
    name: "test",
    label: "Test",
    status,
    responseTimeMs: 1,
    lastChecked: "2026-09-08T10:00:00.000Z",
  };
}

describe("overallStatus", () => {
  it("reports healthy when every service is healthy", () => {
    expect(overallStatus([service("healthy"), service("healthy")])).toBe("healthy");
  });

  it("ignores optional not_configured services when aggregating", () => {
    expect(
      overallStatus([service("healthy"), service("healthy"), service("not_configured")]),
    ).toBe("healthy");
  });

  it("reports degraded when any required service is degraded", () => {
    expect(overallStatus([service("healthy"), service("degraded")])).toBe("degraded");
  });

  it("reports degraded even when an optional service is unconfigured", () => {
    expect(
      overallStatus([service("degraded"), service("not_configured")]),
    ).toBe("degraded");
  });

  it("reports unhealthy when any service is offline", () => {
    expect(overallStatus([service("healthy"), service("offline")])).toBe("unhealthy");
  });

  it("offline always wins over degraded and not_configured", () => {
    expect(
      overallStatus([service("offline"), service("degraded"), service("not_configured")]),
    ).toBe("unhealthy");
  });
});

const baseLoop: MonitorLoop = {
  id: "loop-1",
  detectorId: "det-1",
  detectorKey: "person",
  detectorName: "Person Detection",
  camera: {
    id: "cam-1",
    name: "Front Gate",
    url: "rtsp://example/cam",
    cameraType: CameraType.rtsp,
  },
  intervalMs: 2000,
  status: "ok",
  nextRunAt: "2026-09-08T10:00:00.000Z",
  lastRunAt: "2026-09-08T09:59:58.000Z",
  lastSuccessAt: "2026-09-08T09:59:58.000Z",
  framesProcessed: 12,
  detectionsCreated: 3,
  errorCount: 1,
  consecutiveFailures: 0,
  lastError: null,
  lastErrorAt: null,
  lastProcessingTimeMs: 145,
  videoPosSeconds: 0,
  runsStarted: 1,
  runsSucceeded: 1,
};

const schedulerStatus: MonitorStatus = {
  running: true,
  startedAt: "2026-09-08T09:00:00.000Z",
  stoppedAt: null,
  tickMs: 1000,
  loopCount: 1,
  framesProcessed: 12,
  detectionsCreated: 3,
  errorCount: 1,
  lastTickAt: "2026-09-08T09:59:59.000Z",
  nextTickAt: "2026-09-08T10:00:01.000Z",
  tickCount: 100,
  lastTickDurationMs: 14,
  lastTickError: null,
  loops: [baseLoop],
};

describe("toSchedulerSummary", () => {
  it("maps scheduler state and aggregates loop counters", () => {
    const summary = toSchedulerSummary(schedulerStatus);
    expect(summary.running).toBe(true);
    expect(summary.tickMs).toBe(1000);
    expect(summary.loopCount).toBe(1);
    expect(summary.framesProcessed).toBe(12);
    expect(summary.detectionsCreated).toBe(3);
    expect(summary.errorCount).toBe(1);
    expect(summary.tickCount).toBe(100);
    expect(summary.lastTickDurationMs).toBe(14);
    expect(summary.lastTickError).toBeNull();
    expect(summary.loops).toHaveLength(1);
  });

  it("surfaces per-loop runtime facts without leaking camera URLs", () => {
    const summary = toSchedulerSummary(schedulerStatus);
    const loop = summary.loops[0];
    expect(loop.cameraName).toBe("Front Gate");
    expect(loop.status).toBe("ok");
    expect(loop.consecutiveFailures).toBe(0);
    expect(loop.lastProcessingTimeMs).toBe(145);
    expect(loop.videoPosSeconds).toBe(0);
    expect(loop.runsStarted).toBe(1);
    expect(loop.runsSucceeded).toBe(1);
    expect("url" in loop).toBe(false);
  });
});

describe("toSchedulerLoopSummary", () => {
  it("maps the loop fields used by the monitoring UI", () => {
    const loop = toSchedulerLoopSummary(baseLoop);
    expect(loop).toMatchObject({
      id: "loop-1",
      detectorKey: "person",
      detectorName: "Person Detection",
      cameraName: "Front Gate",
      status: "ok",
      intervalMs: 2000,
      framesProcessed: 12,
      detectionsCreated: 3,
      videoPosSeconds: 0,
      runsStarted: 1,
      runsSucceeded: 1,
    });
  });
});

describe("toEngineSummary", () => {
  it("maps the full engine health record", () => {
    const summary = toEngineSummary({
      key: "person",
      status: "ready",
      healthy: true,
      latencyMs: 42,
      throughputFps: 18.2,
      framesProcessed: 120,
      errorCount: 0,
      consecutiveFailures: 0,
      aiReachable: true,
      lastInferenceAt: "2026-09-08T09:59:58.000Z",
      lastSuccessfulInferenceAt: "2026-09-08T09:59:58.000Z",
      lastDetectionAt: "2026-09-08T09:59:58.000Z",
      lastError: null,
      lastErrorAt: null,
    });
    expect(summary).toEqual({
      key: "person",
      status: "ready",
      healthy: true,
      latencyMs: 42,
      throughputFps: 18.2,
      framesProcessed: 120,
      errorCount: 0,
      consecutiveFailures: 0,
      aiReachable: true,
      lastInferenceAt: "2026-09-08T09:59:58.000Z",
      lastSuccessfulInferenceAt: "2026-09-08T09:59:58.000Z",
      lastDetectionAt: "2026-09-08T09:59:58.000Z",
      lastError: null,
      lastErrorAt: null,
    });
  });
});