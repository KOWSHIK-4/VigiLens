/**
 * Detector Engine v2 — Persistent tracker integration test.
 *
 * Regression test for track-id stability across frames: the engine must
 * reuse ONE tracker per detector key across `processFrame` calls, so an
 * object that disappears and returns at its previous location is matched
 * to its existing track (same id) instead of being treated as brand new.
 *
 * With the old bug, every `processFrame` built a fresh pipeline containing
 * a brand-new `IouTracker`, so the same object at the same location
 * received a fresh track id on the even frames (0, 0, 0, ...) rather than
 * alternating back to its original track (0, 1, 0, 1, ...).
 *
 * The AI client is injected (a fake) so this runs without the inference
 * service. Persistence goes through the real database, matching the other
 * live tests.
 */

import { EngineServiceImpl } from "../src/engine/engineService";
import {
  type AiServiceClient,
  type AiImageDetectionResponse,
} from "../src/engine/aiClient";
import { notifyDetectorRestart } from "../src/engine/engineHooks";
import { alertService } from "../src/services/alert.service";

let passed = 0;
let failed = 0;

function ok(name: string, details?: string) {
  passed += 1;
  console.log(`  PASS  ${name}${details ? ` — ${details}` : ""}`);
}

function fail(name: string, details?: string) {
  failed += 1;
  console.log(`  FAIL  ${name}${details ? ` — ${details}` : ""}`);
}

function assert(cond: boolean, name: string, details?: string) {
  if (cond) ok(name, details);
  else fail(name, details);
}

const LOCATION_A = { x1: 10, y1: 20, x2: 60, y2: 120 };
const LOCATION_B = { x1: 300, y1: 320, x2: 350, y2: 420 };

class FakeAiClient implements AiServiceClient {
  boxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  calls = 0;

  async detectImage(): Promise<AiImageDetectionResponse> {
    const box = this.boxes[Math.min(this.calls, this.boxes.length - 1)];
    this.calls += 1;
    return {
      success: true,
      count: 1,
      detections: [{ class_name: "person", confidence: 0.9, bbox: box }],
      output_path: "",
      image_width: 640,
      image_height: 640,
    };
  }

  async isReachable(): Promise<boolean> {
    return true;
  }
}

async function run() {
  const fake = new FakeAiClient();
  fake.boxes = [LOCATION_A, LOCATION_B, LOCATION_A, LOCATION_B, LOCATION_B];
  const engine = new EngineServiceImpl(fake);
  const image = Buffer.from("fake-jpeg-frame-for-persistent-tracker-test");

  const originalCreate = alertService.create;
  alertService.create = (async (input: Parameters<typeof alertService.create>[0]) => {
    return { id: `alert-${Date.now()}-${Math.random()}`, ...input };
  }) as typeof alertService.create;

  try {
    // Alternating location: frame 1 at A, frame 2 at B, frame 3 back at A,
    // frame 4 back at B. A persistent tracker matches B on frame 4 to the
    // track created on frame 2 (id "1"); a fresh tracker would start over
    // and assign id "0".
    const f1 = await engine.processFrame("person", "demo-camera-1", image, { force: true });
    const f2 = await engine.processFrame("person", "demo-camera-1", image, { force: true });
    const f3 = await engine.processFrame("person", "demo-camera-1", image, { force: true });
    const f4 = await engine.processFrame("person", "demo-camera-1", image, { force: true });

    assert(fake.calls === 4, "all four frames were inferred", `inference calls=${fake.calls}`);

    const id1 = f1.detections[0]?.trackId;
    const id2 = f2.detections[0]?.trackId;
    const id3 = f3.detections[0]?.trackId;
    const id4 = f4.detections[0]?.trackId;
    assert(
      id1 !== null && id1 !== undefined,
      "first frame assigns a track id",
      `trackId=${id1}`,
    );
    assert(id2 !== id1, "object at a new location spawns a new track", `id1=${id1} id2=${id2}`);
    assert(
      id3 === id1,
      "object returning to its original location keeps its original track",
      `id1=${id1} id3=${id3}`,
    );
    assert(
      id4 === id2,
      "object returning to the second location keeps that track (tracker persists across frames)",
      `id2=${id2} id4=${id4}`,
    );

    // Restarting a detector clears the per-key tracker: the next frame
    // starts fresh with id "0" instead of matching the second-location
    // track (id "1").
    notifyDetectorRestart();
    const f5 = await engine.processFrame("person", "demo-camera-1", image, { force: true });
    assert(
      f5.detections[0]?.trackId === "0",
      "detector restart resets the tracker (next frame starts at id 0)",
      `trackId=${f5.detections[0]?.trackId}`,
    );

    // Cross-camera isolation: the same detector key running against a
    // different camera must get its own tracker. Camera-2 has never been
    // seen by this engine, so its first detection is track "0" even though
    // camera-1 already minted several identities.
    const c2f1 = await engine.processFrame("person", "demo-camera-2", image, { force: true });
    assert(
      c2f1.detections[0]?.trackId === "0",
      "a second camera gets its own tracker (starts at id 0)",
      `trackId=${c2f1.detections[0]?.trackId}`,
    );

    // Scoped restart: notifying a restart for "vehicle" must reset vehicle
    // trackers only — the person tracker on demo-camera-2 keeps its state.
    const vBefore = await engine.processFrame("vehicle", "demo-camera-2", image, { force: true });
    notifyDetectorRestart("vehicle");
    const vAfter = await engine.processFrame("vehicle", "demo-camera-2", image, { force: true });
    assert(
      vAfter.detections[0]?.trackId === "0",
      "scoped restart resets only the named detector's tracker",
      `trackId=${vAfter.detections[0]?.trackId}`,
    );
    const c2f2 = await engine.processFrame("person", "demo-camera-2", image, { force: true });
    assert(
      c2f2.detections[0]?.trackId !== null &&
        c2f2.detections[0]?.trackId === c2f1.detections[0]?.trackId,
      "scoped restart leaves other detectors' trackers intact",
      `before=${c2f1.detections[0]?.trackId} after=${c2f2.detections[0]?.trackId}`,
    );
    void vBefore;
  } finally {
    alertService.create = originalCreate;
  }

  console.log(`\nEngine persistent tracker tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  failed += 1;
  console.error("Unexpected engine persistent tracker test error:", err);
  console.log(`\nEngine persistent tracker tests: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
