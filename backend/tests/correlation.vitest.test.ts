/**
 * Event correlation — pure unit tests.
 *
 * Exercises the deterministic core of the correlation engine without any
 * database: bucket boundaries, event id stability, grouping rules and
 * summary aggregation.
 */

import { describe, expect, it } from "vitest";
import {
  CORRELATION_DEFAULT_WINDOW_MS,
  correlationGroupKey,
  correlationMessageSuffix,
  eventBucketStart,
  eventIdFor,
  summarizeCorrelation,
  type DetectionSignal,
} from "../src/services/correlation";

const WINDOW = CORRELATION_DEFAULT_WINDOW_MS; // 30_000

function signal(partial: Partial<DetectionSignal> & { id: string }): DetectionSignal {
  return {
    cameraId: "cam-1",
    detectorKey: "person",
    className: "person",
    label: "person",
    timestamp: new Date("2026-01-01T00:00:10.000Z"),
    confidence: 0.9,
    trackId: null,
    ...partial,
  };
}

describe("eventBucketStart", () => {
  it("anchors buckets at the epoch (fixed alignment)", () => {
    expect(eventBucketStart(10_000, WINDOW)).toBe(0);
    expect(eventBucketStart(30_000, WINDOW)).toBe(30_000);
    expect(eventBucketStart(59_999, WINDOW)).toBe(30_000);
    expect(eventBucketStart(30_001, WINDOW)).toBe(30_000);
    expect(eventBucketStart(60_000, WINDOW)).toBe(60_000);
  });

  it("rejects an invalid window", () => {
    expect(() => eventBucketStart(10_000, 0)).toThrow();
    expect(() => eventBucketStart(10_000, -5)).toThrow();
    expect(() => eventBucketStart(10_000, NaN)).toThrow();
  });
});

describe("correlationGroupKey", () => {
  it("distinguishes camera, detector and class", () => {
    expect(correlationGroupKey("cam-1", "person", "person")).not.toBe(
      correlationGroupKey("cam-2", "person", "person"),
    );
    expect(correlationGroupKey("cam-1", "person", "person")).not.toBe(
      correlationGroupKey("cam-1", "vehicle", "vehicle"),
    );
    expect(correlationGroupKey("cam-1", "person", "person")).not.toBe(
      correlationGroupKey("cam-1", "person", "bag"),
    );
  });

  it("never collapses a missing class onto a real class", () => {
    expect(correlationGroupKey("cam-1", "person", null)).not.toBe(
      correlationGroupKey("cam-1", "person", "person"),
    );
  });
});

describe("eventIdFor", () => {
  it("is deterministic and stable across repeated calls", () => {
    const id1 = eventIdFor("cam-1|person|person", 0);
    const id2 = eventIdFor("cam-1|person|person", 0);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^evt-[0-9a-f]{12}$/);
  });

  it("differs across groups and buckets", () => {
    expect(eventIdFor("cam-1|person|person", 0)).not.toBe(
      eventIdFor("cam-2|person|person", 0),
    );
    expect(eventIdFor("cam-1|person|person", 0)).not.toBe(
      eventIdFor("cam-1|person|person", WINDOW),
    );
    expect(eventIdFor("cam-1|person|person", 0)).not.toBe(
      eventIdFor("cam-1|vehicle|vehicle", 0),
    );
  });
});

describe("summarizeCorrelation", () => {
  it("marks a single detection as uncorrelated", () => {
    const summary = summarizeCorrelation([signal({ id: "d1" })], WINDOW, "engine");
    expect(summary.correlated).toBe(false);
    expect(summary.count).toBe(1);
    expect(summary.eventId).toMatch(/^evt-/);
  });

  it("correlates two detections in the same bucket", () => {
    const s1 = signal({ id: "d1", timestamp: new Date("2026-01-01T00:00:05.000Z"), confidence: 0.8 });
    const s2 = signal({
      id: "d2",
      timestamp: new Date("2026-01-01T00:00:12.000Z"),
      confidence: 0.95,
      trackId: "t-1",
    });
    const summary = summarizeCorrelation([s1, s2], WINDOW, "engine");

    expect(summary.correlated).toBe(true);
    expect(summary.count).toBe(2);
    expect(summary.labels).toEqual(["person"]);
    expect(summary.trackIds).toEqual(["t-1"]);
    expect(summary.maxConfidence).toBe(0.95);
    expect(summary.avgConfidence).toBeCloseTo(0.875);
    expect(summary.firstSeenAt).toBe(s1.timestamp.toISOString());
    expect(summary.lastSeenAt).toBe(s2.timestamp.toISOString());
    expect(summary.source).toBe("engine");
    expect(summary.reason).toContain("2 related detections");
  });

  it("splits detections that straddle a bucket boundary", () => {
    const before = signal({ id: "d1", timestamp: new Date("2026-01-01T00:00:29.999Z") });
    const at = signal({ id: "d2", timestamp: new Date("2026-01-01T00:00:30.000Z") });

    const a = summarizeCorrelation([before], WINDOW, "engine");
    const b = summarizeCorrelation([at], WINDOW, "engine");
    expect(a.eventId).not.toBe(b.eventId);
  });

  it("does not merge different cameras or classes", () => {
    const cam2 = signal({ id: "d2", cameraId: "cam-2" });
    const otherClass = signal({ id: "d3", className: "bag", label: "bag" });

    const a = summarizeCorrelation([signal({ id: "d1" })], WINDOW, "engine");
    expect(summarizeCorrelation([cam2], WINDOW, "engine").eventId).not.toBe(a.eventId);
    expect(summarizeCorrelation([otherClass], WINDOW, "engine").eventId).not.toBe(a.eventId);
  });

  it("produces the same event id for the same event re-processed out of order (idempotence)", () => {
    const s1 = signal({ id: "d1", timestamp: new Date("2026-01-01T00:00:05.000Z") });
    const s2 = signal({ id: "d2", timestamp: new Date("2026-01-01T00:00:12.000Z") });
    const s3 = signal({ id: "d1", timestamp: new Date("2026-01-01T00:00:05.000Z") });

    const first = summarizeCorrelation([s1, s2], WINDOW, "engine");
    const second = summarizeCorrelation([s2, s3], WINDOW, "api");

    expect(second.eventId).toBe(first.eventId);
    expect(second.eventId).toBe(
      eventIdFor(correlationGroupKey("cam-1", "person", "person"), eventBucketStart(s1.timestamp.getTime(), WINDOW)),
    );
  });

  it("rejects an empty detection set", () => {
    expect(() => summarizeCorrelation([], WINDOW, "engine")).toThrow();
  });
});

describe("correlationMessageSuffix", () => {
  it("returns an explainable suffix only when correlated", () => {
    const single = summarizeCorrelation([signal({ id: "d1" })], WINDOW, "engine");
    const multi = summarizeCorrelation(
      [signal({ id: "d1" }), signal({ id: "d2" })],
      WINDOW,
      "engine",
    );

    expect(correlationMessageSuffix(single)).toBe("");
    expect(correlationMessageSuffix(multi)).toContain(multi.eventId);
    expect(correlationMessageSuffix(multi)).toContain("2 detections");
    expect(correlationMessageSuffix(null)).toBe("");
    expect(correlationMessageSuffix(undefined)).toBe("");
  });
});