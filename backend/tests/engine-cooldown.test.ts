/**
 * Detector Engine v2 — Alert cooldown integration test.
 *
 * Regression test for the per-detector alert cooldown: the cooldown
 * registry must be shared across pipeline runs, so two frames processed
 * back-to-back for the same (detector, camera, class) within
 * `alertCooldownMs` raise exactly ONE alert. Previously every frame built
 * a fresh `CooldownAlertStage` with its own registry, so the cooldown
 * never suppressed anything.
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

class FakeAiClient implements AiServiceClient {
  calls = 0;

  async detectImage(): Promise<AiImageDetectionResponse> {
    this.calls += 1;
    return {
      success: true,
      count: 1,
      detections: [
        { class_name: "person", confidence: 0.9, bbox: { x1: 10, y1: 20, x2: 60, y2: 120 } },
      ],
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
  const engine = new EngineServiceImpl(fake);
  const image = Buffer.from("fake-jpeg-frame-for-cooldown-test");

  const originalCreate = alertService.create;
  const alertTitles: string[] = [];
  alertService.create = (async (input: Parameters<typeof alertService.create>[0]) => {
    alertTitles.push(input.title);
    return { id: `alert-${alertTitles.length}`, ...input };
  }) as typeof alertService.create;

  try {
    const first = await engine.processFrame("person", "demo-camera-1", image, { force: true });
    const second = await engine.processFrame("person", "demo-camera-1", image, { force: true });

    assert(fake.calls === 2, "both frames were inferred", `inference calls=${fake.calls}`);
    assert(
      first.detections.length === 1 && second.detections.length === 1,
      "detections persisted for both frames",
      `first=${first.detections.length} second=${second.detections.length}`,
    );
    assert(
      alertTitles.length === 1,
      "alert cooldown suppresses the second alert",
      `alertService.create calls=${alertTitles.length}`,
    );
    if (alertTitles.length === 1) {
      ok("raised alert matches detector/class title", alertTitles[0]);
    }

    const third = await engine.processFrame("person", "demo-camera-2", image, { force: true });
    assert(
      alertTitles.length === 2,
      "cooldown is scoped per camera",
      `alertService.create calls after different camera=${alertTitles.length}`,
    );
  } finally {
    alertService.create = originalCreate;
  }

  console.log(`\nEngine cooldown tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  failed += 1;
  console.error("Unexpected engine cooldown test error:", err);
  console.log(`\nEngine cooldown tests: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
