import {
  cameraInputFor,
  detectorSupportsCamera,
} from "../src/services/detector.service";
import {
  updateDetectorSchema,
  detectorSettingsSchema,
  detectorCamerasSchema,
  detectorQuerySchema,
} from "../src/types";

let passed = 0;
let failed = 0;

function ok(name: string) {
  passed += 1;
  console.log(`  PASS  ${name}`);
}

function fail(name: string, detail: unknown) {
  failed += 1;
  console.error(`  FAIL  ${name}`);
  console.error(`        ${JSON.stringify(detail)}`);
}

function expectEqual(actual: unknown, expected: unknown, name: string) {
  if (actual === expected) ok(name);
  else fail(name, { actual, expected });
}

function expectParseSuccess(schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown, name: string) {
  const result = schema.safeParse(value);
  if (result.success) ok(name);
  else fail(name, result);
}

function expectParseError(schema: { safeParse: (v: unknown) => { success: boolean; error?: unknown } }, value: unknown, name: string) {
  const result = schema.safeParse(value);
  if (!result.success) ok(name);
  else fail(name, `expected rejection but parsed: ${JSON.stringify(value)}`);
}

// --- Camera input compatibility mapping ---

expectEqual(cameraInputFor("usb"), "webcam", "usb camera maps to webcam input");
expectEqual(cameraInputFor("rtsp"), "video", "rtsp camera maps to video input");
expectEqual(cameraInputFor("ip"), "video", "ip camera maps to video input");
expectEqual(cameraInputFor("video_file"), "video", "video_file camera maps to video input");

expectEqual(detectorSupportsCamera(["image", "video", "webcam"], "usb"), true, "person-style detector supports usb webcam");
expectEqual(detectorSupportsCamera(["image", "video", "webcam"], "rtsp"), true, "person-style detector supports rtsp feed");
expectEqual(detectorSupportsCamera(["image", "video"], "rtsp"), true, "detector without webcam supports rtsp feed");
expectEqual(detectorSupportsCamera(["image", "video"], "usb"), false, "detector without webcam rejects usb feed");
expectEqual(detectorSupportsCamera(["image"], "video_file"), false, "image-only detector rejects video file feed");
expectEqual(detectorSupportsCamera(["webcam"], "rtsp"), false, "webcam-only detector rejects rtsp feed");

// --- Update detector schema ---

expectParseSuccess(updateDetectorSchema, { name: "Person Detection v2" }, "update: single field accepted");
expectParseSuccess(updateDetectorSchema, { name: "A", description: "d", version: "2.0.0", enabled: false }, "update: all fields accepted");
expectParseError(updateDetectorSchema, {}, "update: empty body rejected");
expectParseError(updateDetectorSchema, { enabled: "yes" }, "update: non-boolean enabled rejected");
expectParseError(updateDetectorSchema, { name: "" }, "update: empty name rejected");

// --- Settings schema (confidence 0-100, interval positive, cooldown non-negative) ---

expectParseSuccess(detectorSettingsSchema, { confidenceThreshold: 0 }, "settings: threshold 0 accepted");
expectParseSuccess(detectorSettingsSchema, { confidenceThreshold: 100 }, "settings: threshold 100 accepted");
expectParseError(detectorSettingsSchema, { confidenceThreshold: -1 }, "settings: negative threshold rejected");
expectParseError(detectorSettingsSchema, { confidenceThreshold: 101 }, "settings: threshold > 100 rejected");
expectParseSuccess(detectorSettingsSchema, { detectionIntervalMs: 5000 }, "settings: positive interval accepted");
expectParseError(detectorSettingsSchema, { detectionIntervalMs: 0 }, "settings: zero interval rejected");
expectParseError(detectorSettingsSchema, { detectionIntervalMs: -100 }, "settings: negative interval rejected");
expectParseSuccess(detectorSettingsSchema, { alertCooldownMs: 0 }, "settings: zero cooldown accepted (non-negative)");
expectParseSuccess(detectorSettingsSchema, { alertCooldownMs: 30000 }, "settings: positive cooldown accepted");
expectParseError(detectorSettingsSchema, { alertCooldownMs: -1 }, "settings: negative cooldown rejected");
expectParseError(detectorSettingsSchema, { alertSeverity: "extreme" }, "settings: unknown severity rejected");

// --- Camera assignment schema ---

expectParseSuccess(detectorCamerasSchema, { cameraIds: ["demo-camera-1", "demo-camera-2"] }, "cameras: plain cameraIds accepted");
expectParseSuccess(
  detectorCamerasSchema,
  { assignments: [{ cameraId: "demo-camera-1", enabled: false }, { cameraId: "demo-camera-2", enabled: true }] },
  "cameras: assignments with per-camera enabled accepted",
);
expectParseError(detectorCamerasSchema, {}, "cameras: empty body rejected");
expectParseError(detectorCamerasSchema, { cameraIds: ["a"], assignments: [{ cameraId: "b", enabled: true }] }, "cameras: both cameraIds and assignments rejected");
expectParseError(detectorCamerasSchema, { assignments: [] }, "cameras: empty assignments rejected");
expectParseError(detectorCamerasSchema, { cameraIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", ...Array(75).fill("x")] }, "cameras: more than 100 cameras rejected");
expectParseError(detectorCamerasSchema, { cameraIds: [""] }, "cameras: empty camera id rejected");
expectParseError(detectorCamerasSchema, { cameraIds: ["a"], assignments: [{ cameraId: "b", enabled: "yes" }] }, "cameras: non-boolean enabled rejected");

// --- Query schema (filters) ---

expectParseSuccess(detectorQuerySchema, { status: "ready" }, "query: lifecycle status accepted");
expectParseSuccess(detectorQuerySchema, { status: "running" }, "query: legacy status accepted");
expectParseError(detectorQuerySchema, { status: "bogus" }, "query: unknown status rejected");
expectParseSuccess(detectorQuerySchema, { type: "object_detection" }, "query: type filter accepted");
expectParseError(detectorQuerySchema, { type: "nonsense" }, "query: unknown type rejected");
expectParseSuccess(detectorQuerySchema, { enabled: "true" }, "query: enabled filter accepted");
expectParseError(detectorQuerySchema, { enabled: "yes" }, "query: invalid enabled filter rejected");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);