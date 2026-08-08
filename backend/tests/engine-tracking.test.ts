import { IouTracker } from "../src/engine/tracking";
import type { RawDetection } from "../src/engine/types";

let passed = 0;
let failed = 0;

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, details?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
}

function assert(cond: boolean, name: string, details?: string) {
  if (cond) {
    ok(name);
  } else {
    fail(name, details);
  }
}

function box(x1: number, y1: number, x2: number, y2: number) {
  return { x1, y1, x2, y2 };
}

function person(x1: number, y1: number, x2: number, y2: number, confidence = 0.9): RawDetection {
  return { className: "person", confidence, bbox: box(x1, y1, x2, y2) };
}

function run() {
  const tracker = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });

  // First frame: every detection spawns a new track.
  const t0 = tracker.update([person(0, 0, 10, 10), person(100, 100, 110, 110)], 1);
  assert(t0[0].trackId !== null && t0[1].trackId !== null, "first frame creates tracks");
  assert(t0[0].trackId !== t0[1].trackId, "distinct objects get distinct track ids");

  // Second frame: overlapping detections keep the same track id.
  const t1 = tracker.update([person(1, 1, 11, 11), person(100, 100, 110, 110)], 2);
  assert(t1[0].trackId === t0[0].trackId, "moving object keeps its track id");
  assert(t1[1].trackId === t0[1].trackId, "static object keeps its track id");

  // A new object far from existing tracks spawns a new track.
  const t2 = tracker.update([person(1, 1, 11, 11), person(100, 100, 110, 110), person(300, 300, 310, 310)], 3);
  const thirdId = t2[2].trackId;
  assert(
    thirdId !== null && thirdId !== t0[0].trackId && thirdId !== t0[1].trackId,
    "new object spawns a new track",
  );

  // Tracks are per-class.
  const crossClass = tracker.update(
    [{ className: "vehicle", confidence: 0.9, bbox: box(1, 1, 11, 11) }],
    4,
  );
  assert(crossClass[0].trackId !== t0[0].trackId, "different classes never share a track id");

  // Unmatched tracks age out after maxMisses.
  const tracker2 = new IouTracker({ matchIoU: 0.35, maxMisses: 2 });
  const a = tracker2.update([person(0, 0, 10, 10)], 1);
  const aId = a[0].trackId;
  assert(aId !== null, "fresh tracker assigns a track id");
  tracker2.update([person(100, 100, 110, 110)], 2);
  tracker2.update([person(100, 100, 110, 110)], 3);
  tracker2.update([person(100, 100, 110, 110)], 4);
  const reused = tracker2.update([person(0, 0, 10, 10)], 5);
  assert(reused[0].trackId !== aId, "retired track id is reused after maxMisses");

  // activeTrackCount reflects live tracks.
  const tracker3 = new IouTracker({ matchIoU: 0.35, maxMisses: 10 });
  tracker3.update([person(0, 0, 10, 10)], 1);
  assert(tracker3.activeTrackCount === 1, "activeTrackCount reports live tracks");

  // reset clears state and id counter.
  tracker3.reset();
  assert(tracker3.activeTrackCount === 0, "reset clears all tracks");

  console.log(`\nEngine tracking tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
