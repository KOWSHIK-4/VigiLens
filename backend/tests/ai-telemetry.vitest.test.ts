/**
 * AI telemetry aggregation — pure unit tests.
 *
 * Pins the honesty contract: accuracy/precision/recall are only reported as
 * measured (never approximated), statuses stay explainable, and malformed
 * or missing inputs aggregate to safe zeroed structures.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateAITelemetry,
  type AITelemetryInput,
} from "../src/services/aiTelemetry";

const base = (overrides: Partial<AITelemetryInput> = {}): AITelemetryInput => ({
  testSuccessCount: 0,
  testFailureCount: 0,
  averageLatencyMs: 0,
  latencySampleCount: 0,
  registeredModelCount: 0,
  activeModelCount: 0,
  engineModelNames: [],
  recentDetectionCount: 0,
  uptimeMs: 0,
  ...overrides,
});

describe("aggregateAITelemetry", () => {
  it("reports not_configured with zeroed facts for an empty deployment", () => {
    const summary = aggregateAITelemetry(base());
    expect(summary.status).toBe("not_configured");
    expect(summary.inference.probeTotal).toBe(0);
    expect(summary.inference.lastProbeOutcome).toBe("no_probe");
    expect(summary.pipeline.sampleCount).toBe(0);
  });

  it("never fabricates accuracy without labeled ground truth", () => {
    const summary = aggregateAITelemetry(base());
    expect(summary.accuracy.accuracy).toBeNull();
    expect(summary.accuracy.precision).toBeNull();
    expect(summary.accuracy.recall).toBeNull();
    expect(summary.accuracy.f1Score).toBeNull();
    expect(summary.accuracy.reason).toContain("No labeled ground-truth set");
  });

  it("reports accuracy only when labeled records exist", () => {
    const summary = aggregateAITelemetry(
      base({ labeledRecords: 10, labeledCorrect: 8, registeredModelCount: 2 }),
    );
    expect(summary.accuracy.accuracy).toBe(0.8);
    expect(summary.accuracy.fromLabeledRecords).toBe(10);
    expect(summary.accuracy.precision).toBeNull();
  });

  it("computes probe success rate from real probe counters", () => {
    const summary = aggregateAITelemetry(
      base({ testSuccessCount: 7, testFailureCount: 3 }),
    );
    expect(summary.inference.probeTotal).toBe(10);
    expect(summary.inference.successRate).toBe(0.7);
    expect(summary.inference.lastProbeOutcome).toBe("failed");
  });

  it("reports a healthy active deployment as ok", () => {
    const summary = aggregateAITelemetry(
      base({
        registeredModelCount: 4,
        activeModelCount: 2,
        testSuccessCount: 5,
      }),
    );
    expect(summary.status).toBe("ok");
    expect(summary.inference.lastProbeOutcome).toBe("succeeded");
  });

  it("degrades status when real probes have failed", () => {
    const summary = aggregateAITelemetry(
      base({
        registeredModelCount: 4,
        activeModelCount: 2,
        testSuccessCount: 1,
        testFailureCount: 2,
      }),
    );
    expect(summary.status).toBe("degraded");
  });

  it("marks unavailable when models exist but none are active", () => {
    const summary = aggregateAITelemetry(
      base({ registeredModelCount: 4, activeModelCount: 0 }),
    );
    expect(summary.status).toBe("unavailable");
  });

  it("exposes the real engine model mapping", () => {
    const summary = aggregateAITelemetry(
      base({ registeredModelCount: 1, activeModelCount: 1, engineModelNames: ["person-detect"] }),
    );
    expect(summary.modelHealth.engineModels).toContain("person-detect");
  });

  it("rounds latency to two decimals and keeps the measured average", () => {
    const summary = aggregateAITelemetry(
      base({ averageLatencyMs: 12.345, latencySampleCount: 40, recentDetectionCount: 300 }),
    );
    expect(summary.pipeline.averageLatencyMs).toBe(12.35);
    expect(summary.pipeline.sampleCount).toBe(40);
    expect(summary.pipeline.recentDetectionCount).toBe(300);
  });

  it("sanitizes hostile inputs instead of throwing", () => {
    expect(() =>
      aggregateAITelemetry(
        base({
          averageLatencyMs: Number.NaN,
          latencySampleCount: -10,
          testSuccessCount: Number.POSITIVE_INFINITY,
          uptimeMs: -5,
        }),
      ),
    ).not.toThrow();
    const summary = aggregateAITelemetry(base({ averageLatencyMs: Number.NaN }));
    expect(summary.pipeline.averageLatencyMs).toBe(0);
    expect(summary.pipeline.sampleCount).toBe(0);
  });
});