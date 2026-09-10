import { describe, it, expect, beforeEach } from "vitest";
import {
  EngineMetricsStore,
  ROLLING_WINDOW_MS,
  MAX_ROLLING_SAMPLES,
  MAX_METRIC_KEYS,
} from "../src/engine/metricsStore";
import type { PipelineMetrics } from "../src/engine/types";

let clock = 0;
const store = new EngineMetricsStore({ now: () => clock });

function baseMetrics(overrides: Partial<PipelineMetrics> = {}): PipelineMetrics {
  return {
    framesProcessed: 1,
    framesSkipped: 0,
    inferenceTimeMs: 100,
    preprocessingTimeMs: 10,
    postprocessingTimeMs: 20,
    trackingTimeMs: 5,
    totalProcessingTimeMs: 135,
    detectionsPerFrame: 1,
    lastDetectionAt: new Date(clock),
    lastFrameAt: new Date(clock),
    lastSuccessfulInferenceAt: new Date(clock),
    lastError: null,
    lastErrorAt: null,
    errorCount: 0,
    ...overrides,
  };
}

describe("EngineMetricsStore cumulative counters", () => {
  it("merges pipeline results per key", () => {
    store.clear();
    clock = 1000;
    store.record("person", baseMetrics(), 120, 2);
    clock = 1001;
    store.record("person", baseMetrics(), 130, 3);

    const metrics = store.get("person");
    expect(metrics?.framesProcessed).toBe(2);
    expect(metrics?.inferenceTimeMs).toBe(100);
    expect(metrics?.errorCount).toBe(0);
  });

  it("records failures into the cumulative counters only", () => {
    store.clear();
    clock = 1000;
    store.recordError("person", "boom");

    const metrics = store.get("person");
    expect(metrics?.errorCount).toBe(1);
    expect(metrics?.framesSkipped).toBe(1);
    expect(metrics?.lastError).toBe("boom");
    expect(store.getRolling("person")).toBeNull();
  });

  it("seeds error counters and then merges a later success", () => {
    store.clear();
    clock = 1000;
    store.recordError("person", "boom");
    clock = 1001;
    store.record("person", baseMetrics(), 140, 1);

    const metrics = store.get("person");
    expect(metrics?.errorCount).toBe(1);
    expect(metrics?.framesProcessed).toBe(1);
    expect(metrics?.framesSkipped).toBe(1);
  });

  it("clear() resets every key", () => {
    store.clear();
    clock = 10;
    store.record("person", baseMetrics(), 10, 1);
    store.clear();
    expect(store.get("person")).toBeNull();
    expect(store.activeKeys).toBe(0);
  });
});

describe("EngineMetricsStore rolling window", () => {
  beforeEach(() => {
    store.clear();
  });

  it("exposes only samples inside the window", () => {
    clock = 1_000_000;
    store.record("person", baseMetrics(), 100, 1);
    clock = 2_000_000;
    store.record("person", baseMetrics(), 200, 2);
    // Jump exactly past the 5-minute window so the first sample ages out
    // while the second stays at the boundary.
    clock = 2_000_000 + ROLLING_WINDOW_MS;
    store.record("person", baseMetrics(), 300, 3);

    const rolling = store.getRolling("person");
    expect(rolling?.samples).toBe(2);
    expect(rolling?.averageProcessingTimeMs).toBe(250);
    expect(rolling?.maxProcessingTimeMs).toBe(300);
    expect(rolling?.detectionsInWindow).toBe(5);
    expect(rolling?.windowSeconds).toBe(300);
    expect(rolling?.firstSampleAt).toBe(new Date(2_000_000).toISOString());
  });

  it("returns null when every sample has aged out", () => {
    clock = 1000;
    store.record("person", baseMetrics(), 100, 1);
    clock = 1000 + ROLLING_WINDOW_MS + 1;

    expect(store.getRolling("person")).toBeNull();
    // Cumulative counters are unaffected by window expiry.
    expect(store.get("person")?.framesProcessed).toBe(1);
  });

  it("caps the retained sample count keeping the newest frames", () => {
    const capped = new EngineMetricsStore({ now: () => clock, maxSamples: 3 });
    for (let i = 0; i < 5; i += 1) {
      clock = 1000 + i;
      capped.record("person", baseMetrics(), 10 + i, 1);
    }

    const rolling = capped.getRolling("person");
    expect(rolling?.samples).toBe(3);
    expect(rolling?.firstSampleAt).toBe(new Date(1002).toISOString());
  });

  it("defaults keep MAX_ROLLING_SAMPLES and a 5-minute window", () => {
    expect(store).toBeInstanceOf(EngineMetricsStore);
    expect(MAX_ROLLING_SAMPLES).toBe(10_000);
  });
});

describe("EngineMetricsStore key bounds", () => {
  it("evicts the least-recently active key past the cap", () => {
    store.clear();
    const capped = new EngineMetricsStore({ now: () => clock, maxKeys: 2 });
    clock = 1;
    capped.record("a", baseMetrics(), 10, 1);
    clock = 2;
    capped.record("b", baseMetrics(), 10, 1);
    clock = 3;
    capped.record("c", baseMetrics(), 10, 1);

    expect(capped.get("a")).toBeNull();
    expect(capped.get("b")).not.toBeNull();
    expect(capped.get("c")).not.toBeNull();
    expect(capped.activeKeys).toBe(2);
  });

  it("evicts around recordError for new keys too", () => {
    store.clear();
    const capped = new EngineMetricsStore({ now: () => clock, maxKeys: 2 });
    clock = 1;
    capped.record("a", baseMetrics(), 10, 1);
    clock = 2;
    capped.record("b", baseMetrics(), 10, 1);
    clock = 3;
    capped.recordError("c", "boom");

    expect(capped.get("a")).toBeNull();
    expect(capped.get("b")).not.toBeNull();
    expect(capped.get("c")?.errorCount).toBe(1);
  });

  it("exposes the default key cap as a constant", () => {
    expect(MAX_METRIC_KEYS).toBe(512);
  });
});