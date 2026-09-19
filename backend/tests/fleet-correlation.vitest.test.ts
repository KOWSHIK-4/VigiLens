/**
 * Cross-camera fleet correlation — pure unit tests.
 *
 * Pins the conservative contract: no identity claims, no cross-class
 * merging, bounded deterministic windows, per-camera inclusion rules and
 * stable sequence ids.
 */

import { describe, expect, it } from "vitest";
import {
  correlateFleet,
  FLEET_DEFAULT_WINDOW_MS,
  FLEET_MAX_WINDOW_MS,
  fleetBucketStart,
  type FleetDetectionInput,
} from "../src/services/fleetCorrelation";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const WINDOW = FLEET_DEFAULT_WINDOW_MS;

function det(partial: Partial<FleetDetectionInput> & { id: string }): FleetDetectionInput {
  return {
    cameraId: "cam-a",
    cameraName: "Camera A",
    detectorKey: "person",
    className: "person",
    label: "person",
    confidence: 0.9,
    timestamp: new Date(NOW.getTime() - 60_000),
    trackId: null,
    ...partial,
  };
}

describe("fleetBucketStart", () => {
  it("aligns buckets at the epoch like the per-camera engine", () => {
    expect(fleetBucketStart(0, WINDOW)).toBe(0);
    expect(fleetBucketStart(WINDOW - 1, WINDOW)).toBe(0);
    expect(fleetBucketStart(WINDOW, WINDOW)).toBe(WINDOW);
  });
});

describe("correlateFleet", () => {
  it("correlates the same class across two cameras into one related sequence", () => {
    const sequences = correlateFleet(
      [
        det({ id: "da1", cameraId: "cam-a", cameraName: "Camera A" }),
        det({ id: "db1", cameraId: "cam-b", cameraName: "Camera B" }),
      ],
      WINDOW,
      NOW,
    );
    expect(sequences).toHaveLength(1);
    const seq = sequences[0]!;
    expect(seq.relationship).toBe("related_event");
    expect(seq.cameraIds.sort()).toEqual(["cam-a", "cam-b"]);
    expect(seq.identity).toBe("not_inferred");
    expect(seq.reason).toContain("no identity between them is inferred");
    expect(seq.sequenceId).toMatch(/^seq-[0-9a-f]{12}$/);
  });

  it("does not merge detections on a single camera (same-camera behavior)", () => {
    const sequences = correlateFleet(
      [
        det({ id: "da1", cameraId: "cam-a" }),
        det({ id: "da2", cameraId: "cam-a" }),
      ],
      WINDOW,
      NOW,
    );
    expect(sequences).toHaveLength(0);
  });

  it("does not correlate activity between unrelated detections (different classes)", () => {
    const sequences = correlateFleet(
      [
        det({ id: "da1", cameraId: "cam-a", className: "person" }),
        det({ id: "db1", cameraId: "cam-b", className: "vehicle", label: "vehicle" }),
      ],
      WINDOW,
      NOW,
    );
    expect(sequences).toHaveLength(0);
  });

  it("respects the window boundary by ignoring out-of-window rows", () => {
    const sequences = correlateFleet(
      [
        det({ id: "da1", cameraId: "cam-a", timestamp: new Date(NOW.getTime() - WINDOW - 1) }),
        det({ id: "db1", cameraId: "cam-b", timestamp: new Date(NOW.getTime() - WINDOW - 10) }),
      ],
      WINDOW,
      NOW,
    );
    expect(sequences).toHaveLength(0);
  });

  it("treats bucket-boundary-adjacent events as related when inside the window", () => {
    const sequences = correlateFleet(
      [
        det({ id: "da1", cameraId: "cam-a", timestamp: new Date(NOW.getTime() - WINDOW) }),
        det({ id: "db1", cameraId: "cam-b", timestamp: new Date(NOW.getTime() - 1) }),
      ],
      WINDOW,
      NOW,
    );
    expect(sequences).toHaveLength(1);
  });

  it("is idempotent: duplicate rows never double-count or duplicate sequences", () => {
    const input = [
      det({ id: "da1", cameraId: "cam-a" }),
      det({ id: "db1", cameraId: "cam-b" }),
    ];
    const once = correlateFleet(input, WINDOW, NOW);
    const duplicated = correlateFleet([...input, ...input], WINDOW, NOW);
    expect(duplicated).toHaveLength(1);
    expect(duplicated[0]!.sequenceId).toBe(once[0]!.sequenceId);
    expect(duplicated[0]!.cameraIds.sort()).toEqual(["cam-a", "cam-b"]);
  });

  it("is deterministic for identical input (stable ordering)", () => {
    const input = [
      det({ id: "db1", cameraId: "cam-b" }),
      det({ id: "da1", cameraId: "cam-a" }),
      det({ id: "dc1", cameraId: "cam-c" }),
    ];
    const first = correlateFleet(input, WINDOW, NOW);
    const second = correlateFleet([...input].reverse(), WINDOW, NOW);
    expect(second.map((s) => s.sequenceId)).toEqual(first.map((s) => s.sequenceId));
    expect(second[0]!.detectionIds).toEqual(first[0]!.detectionIds);
  });

  it("isolates cameras that are not present in the detected set", () => {
    const sequences = correlateFleet(
      [det({ id: "da1", cameraId: "cam-a" }), det({ id: "db1", cameraId: "cam-b" })],
      WINDOW,
      NOW,
    );
    for (const seq of sequences) {
      expect(seq.cameraIds).not.toContain("cam-ghost");
      for (const member of seq.cameraIds) {
        expect(["cam-a", "cam-b"]).toContain(member);
      }
    }
  });

  it("rejects unbounded or invalid windows", () => {
    expect(() => correlateFleet([], -1, NOW)).toThrow();
    expect(() => correlateFleet([], 0, NOW)).toThrow();
    expect(() =>
      correlateFleet([], FLEET_MAX_WINDOW_MS + 1, NOW),
    ).toThrow();
  });

  it("returns no sequences for empty or invalid input", () => {
    expect(correlateFleet([], WINDOW, NOW)).toHaveLength(0);
    const malformed = { id: "", cameraId: "", timestamp: new Date() } as FleetDetectionInput;
    expect(correlateFleet([malformed], WINDOW, NOW)).toHaveLength(0);
  });
});