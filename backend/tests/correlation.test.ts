/**
 * Event correlation — live integration tests.
 *
 * Verifies the full stack against the real database:
 *
 *   - The engine persists correlated detections with a stable event id for
 *     grouped rows and leaves singletons untouched.
 *   - Events never merge across cameras.
 *   - The existing alert cooldown still suppresses the second alert — event
 *     correlation creates no alerts of its own and cannot bypass the cooldown.
 *   - The internal (machine-to-machine) detection path annotates correlated
 *     detections, keeps severity unchanged, and enriches the alert message
 *     with an explainable event reference.
 *
 * The AI client is injected (a fake) so this runs without the inference
 * service, matching the other live engine tests.
 */

import { EngineServiceImpl } from "../src/engine/engineService";
import {
  type AiServiceClient,
  type AiImageDetectionResponse,
} from "../src/engine/aiClient";
import { alertService } from "../src/services/alert.service";
import { detectionService } from "../src/services/detection.service";
import { prisma } from "../src/config/prisma";

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
  constructor(private readonly className: string) {}

  async detectImage(
    _frame?: Buffer,
    _detectorKey?: string,
    _confidence?: number,
    _processor?: "auto" | "gpu" | "cpu",
  ): Promise<AiImageDetectionResponse> {
    return {
      success: true,
      count: 1,
      detections: [
        { class_name: this.className, confidence: 0.9, bbox: { x1: 10, y1: 20, x2: 60, y2: 120 } },
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

type StoredRow = {
  metadata: unknown;
};

async function storedMetadata(detectionId: string): Promise<Record<string, unknown>> {
  const row: StoredRow | null = await prisma.detection.findUnique({
    where: { id: detectionId },
    select: { metadata: true },
  });
  const metadata = row?.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

type CorrelationLike = {
  correlated: boolean;
  eventId: string;
  count: number;
};

function readCorrelation(metadata: Record<string, unknown>): CorrelationLike | null {
  const c = metadata.correlation;
  if (!c || typeof c !== "object") return null;
  return c as CorrelationLike;
}

async function run() {
  const createdDetectionIds: string[] = [];
  const createdCameraIds: string[] = [];

  const track = (id: string) => createdDetectionIds.push(id);
  const trackCamera = (id: string) => createdCameraIds.push(id);

  try {
    await prisma.camera.upsert({
      where: { id: "demo-camera-1" },
      create: { id: "demo-camera-1", name: "Main Entrance", url: "rtsp://camera-stream", cameraType: "rtsp" },
      update: {},
    });
    await prisma.camera.upsert({
      where: { id: "demo-camera-2" },
      create: { id: "demo-camera-2", name: "Parking Lot", url: "rtsp://parking-cam", cameraType: "rtsp" },
      update: {},
    });

    // ---- Engine path: correlated event on demo-camera-1, unique class ----
    const engine = new EngineServiceImpl(new FakeAiClient("package"));
    const image = Buffer.from("fake-jpeg-frame-for-correlation-test");

    const originalCreate = alertService.create;
    const alertMessages: Array<{ title: string; message: string; severity: string }> = [];
    alertService.create = (async (input: Parameters<typeof alertService.create>[0]) => {
      alertMessages.push({ title: input.title, message: input.message, severity: input.severity });
      return { id: `alert-${alertMessages.length}`, ...input };
    }) as typeof alertService.create;

    try {
      const first = await engine.processFrame("person", "demo-camera-1", image, { force: true });
      const firstId = first.detections[0]?.id;
      if (firstId) track(firstId);

      // Single detection in its own bucket: no annotation written.
      if (firstId) {
        const meta = await storedMetadata(firstId);
        assert(readCorrelation(meta) === null, "singleton detection is not annotated");
      }

      const second = await engine.processFrame("person", "demo-camera-1", image, { force: true });
      const secondId = second.detections[0]?.id;
      if (secondId) track(secondId);

      assert(
        second.detections.length === 1,
        "second frame persisted a detection",
        `count=${second.detections.length}`,
      );

      // Only the frames that carry the event into the bucket are annotated
      // (bounded writes — prior singleton rows are never retroactively
      // rewritten, and the deterministic event id keeps identity stable).
      let groupEventId: string | null = null;
      if (firstId) {
        const meta1 = await storedMetadata(firstId);
        assert(
          readCorrelation(meta1) === null,
          "prior singleton row is not retroactively annotated",
        );
      }
      if (secondId) {
        const meta2 = await storedMetadata(secondId);
        const c2 = readCorrelation(meta2);
        assert(c2?.correlated === true, "the frame completing the event is annotated");
        assert(
          (c2?.count ?? 0) >= 2,
          "event summary counts the grouped detections",
          `count=${c2?.count}`,
        );
        groupEventId = c2?.eventId ?? null;
      }

      // Alert behavior: first frame raises an alert, the second within the
      // cooldown window is suppressed — correlation must NOT create extra
      // alerts nor bypass the existing cooldown.
      assert(alertMessages.length === 1, "correlation adds no extra alerts (cooldown still applies)");
      if (alertMessages[0]) {
        assert(
          !alertMessages[0].message.includes("Correlated with"),
          "first (single) alert has no correlation suffix",
          alertMessages[0].message,
        );
      }

      // A different camera never joins the same event.
      const engine2 = new EngineServiceImpl(new FakeAiClient("package"));
      const cam2A = await engine2.processFrame("person", "demo-camera-2", image, { force: true });
      const cam2B = await engine2.processFrame("person", "demo-camera-2", image, { force: true });
      const idA = cam2A.detections[0]?.id;
      const idB = cam2B.detections[0]?.id;
      if (idA) track(idA);
      if (idB) track(idB);

      if (idA && idB) {
        const metaB = await storedMetadata(idB);
        const cb = readCorrelation(metaB);
        assert(cb?.correlated === true, "second camera rows group into their own event");
        assert(
          cb?.eventId !== groupEventId,
          "events never merge across cameras",
          `cam1=${groupEventId} cam2=${cb?.eventId}`,
        );
      }
    } finally {
      alertService.create = originalCreate;
    }

    // ---- Service (internal/machine-to-machine) path ----
    const cam3 = await prisma.camera.create({
      data: { name: "correlation-m2m-cam", url: "/dev/null", cameraType: "usb" },
    });
    trackCamera(cam3.id);

    const baseInput = (overrides: Record<string, unknown>) => ({
      cameraId: cam3.id,
      label: "package",
      confidence: 0.9,
      imageUrl: "",
      detectorKey: "person",
      className: "package",
      skipAlert: true,
      applyAlertCooldown: false,
      ...overrides,
    });

    const d1 = await detectionService.create(baseInput({}));
    track(d1.id);
    const d2 = await detectionService.create(baseInput({}));
    track(d2.id);

    const meta1 = await storedMetadata(d1.id);
    const meta2 = await storedMetadata(d2.id);
    const c1 = readCorrelation(meta1);
    const c2 = readCorrelation(meta2);
    assert(c1 === null, "first service detection is a singleton (no annotation)");
    assert(c2?.correlated === true, "second service detection correlates into the same bucket");
    assert(
      c2?.eventId !== null && c2?.eventId !== undefined,
      "service detections carry a stable event id",
      `eventId=${c2?.eventId}`,
    );

    // A full (alert-raising) create on the same correlated event: severity is
    // untouched by correlation and the alert message references the event.
    const d3 = await detectionService.create(
      baseInput({ skipAlert: false, confidence: 0.9 }),
    );
    track(d3.id);
    const meta3 = await storedMetadata(d3.id);
    const c3 = readCorrelation(meta3);
    assert(c3?.correlated === true, "alert-raising create still correlates");
    assert(
      c3 !== null && c2 !== null && c3.eventId === c2.eventId,
      "all members of the event share the same event id",
    );

    const d3Alert = await prisma.alert.findUnique({ where: { detectionId: d3.id } });
    assert(d3Alert !== null, "an alert is raised for the correlated detection");
    if (d3Alert) {
      assert(
        d3Alert.message.includes(`Correlated with ${c3.count} detections`) &&
          d3Alert.message.includes(c3.eventId),
        "alert message references the correlated event",
        d3Alert.message,
      );
      assert(
        d3Alert.severity === "critical",
        "severity stays confidence-derived (correlation never changes it)",
        `severity=${d3Alert.severity}`,
      );
    }

    // A detection with no class signal and no detector key is skipped
    // conservatively (nothing to group by) and never corrupted.
    const d4 = await detectionService.create(
      baseInput({ className: null, detectorKey: null, label: "package", skipAlert: false }),
    );
    track(d4.id);
    const meta4 = await storedMetadata(d4.id);
    assert(readCorrelation(meta4) === null, "detection without grouping signals is skipped, not corrupted");

    const alertsForEvent = await prisma.alert.count({
      where: { detectionId: { in: createdDetectionIds } },
    });
    assert(alertsForEvent === 2, "only the alert-raising creates produced alerts", `alerts=${alertsForEvent}`);
  } finally {
    await prisma.alert
      .deleteMany({ where: { detectionId: { in: createdDetectionIds } } })
      .catch(() => undefined);
    await prisma.detection
      .deleteMany({ where: { id: { in: createdDetectionIds } } })
      .catch(() => undefined);
    for (const cameraId of createdCameraIds) {
      await prisma.camera.deleteMany({ where: { id: cameraId } }).catch(() => undefined);
    }
  }

  console.log(`\nEvent correlation tests: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  failed += 1;
  console.error("Unexpected event correlation test error:", err);
  console.log(`\nEvent correlation tests: ${passed} passed, ${failed} failed`);
  process.exit(1);
});