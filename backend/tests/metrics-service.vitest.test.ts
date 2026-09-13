import { describe, it, expect, beforeEach } from "vitest";
import { metricsService } from "../src/services/metrics.service";

describe("metrics service operational observability", () => {
  beforeEach(() => {
    metricsService.reset();
  });

  it("breaks request metrics down by status code", () => {
    metricsService.recordRequest(10, 200, "/api/alerts");
    metricsService.recordRequest(25, 200, "/api/alerts");
    metricsService.recordRequest(30, 404, "/api/none");
    const snap = metricsService.getSnapshot();
    expect(snap.requests.total).toBe(3);
    expect(snap.requests.statusCodes["200"]).toBe(2);
    expect(snap.requests.statusCodes["404"]).toBe(1);
  });

  it("ranks endpoints by volume", () => {
    metricsService.recordRequest(10, 200, "/api/alerts");
    metricsService.recordRequest(12, 200, "/api/alerts");
    metricsService.recordRequest(15, 201, "/api/incidents");
    const snap = metricsService.getSnapshot();
    expect(snap.requests.topEndpoints).toEqual([
      { endpoint: "/api/alerts", count: 2 },
      { endpoint: "/api/incidents", count: 1 },
    ]);
  });

  it("aggregates operational event counters", () => {
    metricsService.recordEvent("alerts.created");
    metricsService.recordEvent("alerts.created", 2);
    metricsService.recordEvent("webhooks.dispatched");
    const snap = metricsService.getSnapshot();
    expect(snap.operations.counters["alerts.created"]).toBe(3);
    expect(snap.operations.counters["webhooks.dispatched"]).toBe(1);
  });

  it("reports current-value gauges", () => {
    metricsService.setGauge("realtime.subscribers", 4);
    const snap = metricsService.getSnapshot();
    expect(snap.operations.gauges["realtime.subscribers"]).toBe(4);
  });

  it("tracks detection processing samples separately", () => {
    metricsService.recordDetection(42);
    const snap = metricsService.getSnapshot();
    expect(snap.detections.total).toBe(1);
    expect(snap.detections.averageProcessingTimeMs).toBe(42);
  });

  it("reset clears samples and counters", () => {
    metricsService.recordRequest(10, 200, "/api/a");
    metricsService.recordEvent("alerts.created");
    metricsService.setGauge("realtime.subscribers", 1);
    metricsService.reset();
    const snap = metricsService.getSnapshot();
    expect(snap.requests.total).toBe(0);
    expect(snap.operations.counters).toEqual({});
    expect(snap.operations.gauges).toEqual({});
  });
});