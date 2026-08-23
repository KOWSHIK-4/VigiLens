import { describe, it, expect } from "vitest";
import { IouTracker } from "../src/engine/tracking";
import type { RawDetection } from "../src/engine/types";

function box(x1: number, y1: number, x2: number, y2: number) {
  return { x1, y1, x2, y2 };
}

function person(x1: number, y1: number, x2: number, y2: number, confidence = 0.9): RawDetection {
  return { className: "person", confidence, bbox: box(x1, y1, x2, y2) };
}

describe("Engine Tracking", () => {
  it("first frame creates tracks", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
    expect(t0[0].trackId !== null && t0[1].trackId !== null).toBe(true);
  });

  it("distinct objects get distinct track ids", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
    expect(t0[0].trackId !== t0[1].trackId).toBe(true);
  });

  it("moving object keeps its track id", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
    const t1 = tracker.update([person(1, 1, 11, 11), person(100, 100, 110, 110)], 2);
    expect(t1[0].trackId === t0[0].trackId).toBe(true);
  });

  it("static object keeps its track id", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
    const t1 = tracker.update([person(1, 1, 11, 11), person(100, 100, 110, 110)], 2);
    expect(t1[1].trackId === t0[1].trackId).toBe(true);
  });

  it("new object spawns a new track", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
    const t2 = tracker.update([person(1, 1, 11, 11), person(100, 100, 110, 110), person(300, 300, 310, 310)], 3);
    const thirdId = t2[2].trackId;
    expect(thirdId !== null && thirdId !== t0[0].trackId && thirdId !== t0[1].trackId).toBe(true);
  });

  it("different classes never share a track id", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
    const crossClass = tracker.update(
      [{ className: "vehicle", confidence: 0.9, bbox: box(1, 1, 11, 11) }],
      4,
    );
    expect(crossClass[0].trackId !== t0[0].trackId).toBe(true);
  });

  it("fresh tracker assigns a track id", () => {
    const tracker2 = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const a = tracker2.update([person(0, 0, 10, 10)], 1);
    expect(a[0].trackId !== null).toBe(true);
  });

  it("retired track id is reused after maxMisses", () => {
    const tracker2 = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    const a = tracker2.update([person(0, 0, 10, 10)], 1);
    const aId = a[0].trackId;
    tracker2.update([person(100, 100, 110, 110)], 2);
    tracker2.update([person(100, 100, 110, 110)], 3);
    tracker2.update([person(100, 100, 110, 110)], 4);
    const reused = tracker2.update([person(0, 0, 10, 10)], 5);
    expect(reused[0].trackId !== aId).toBe(true);
  });

  it("two overlapping detections cannot claim the same track", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 5 });
    tracker.update([person(0, 0, 10, 10)], 1);
    // Both detections heavily overlap the existing track; only the first
    // may consume it, the second must spawn its own identity.
    const t = tracker.update([person(0, 0, 10, 10), person(1, 1, 11, 11)], 2);
    expect(t[0].trackId).not.toBe(t[1].trackId);
  });

  it("a freshly created track does not start with a miss", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    tracker.update([person(0, 0, 10, 10)], 1);
    // Three absent frames: misses go 1, 2 — still within maxMisses.
    tracker.update([], 2);
    tracker.update([], 3);
    expect(tracker.activeTrackCount).toBe(1);
    // Fourth absent frame pushes misses to 3 and retires the track.
    tracker.update([], 4);
    expect(tracker.activeTrackCount).toBe(0);
  });

  it("re-matching a track resets its miss counter", () => {
    const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
    tracker.update([person(0, 0, 10, 10)], 1);
    tracker.update([], 2); // misses = 1
    tracker.update([person(0, 0, 10, 10)], 3); // re-matched, misses reset
    tracker.update([], 4); // misses = 1
    tracker.update([], 5); // misses = 2, still alive
    expect(tracker.activeTrackCount).toBe(1);
  });

  it("activeTrackCount reports live tracks", () => {
    const tracker3 = new IouTracker({ matchIoU: 0.35, maxMisses: 10 });
    tracker3.update([person(0, 0, 10, 10)], 1);
    expect(tracker3.activeTrackCount).toBe(1);
  });

  it("reset clears all tracks", () => {
    const tracker3 = new IouTracker({ matchIoU: 0.35, maxMisses: 10 });
    tracker3.update([person(0, 0, 10, 10)], 1);
    tracker3.reset();
    expect(tracker3.activeTrackCount).toBe(0);
  });
});
