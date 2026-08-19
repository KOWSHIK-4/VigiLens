import { describe, it, expect } from "vitest";
import {
  validateDetectorConfiguration,
  hasCamera,
  withCamera,
} from "../src/engine/configuration";

function valid() {
  return {
    confidenceThreshold: 50,
    detectionIntervalMs: 1000,
    maxDetectionsPerFrame: 20,
    alertSeverity: "warning",
    alertCooldownMs: 5000,
    cameraIds: ["demo-camera-1"],
    inputResolution: "640x640",
    processingMode: "auto",
  };
}

describe("Engine Config", () => {
  it("valid configuration is accepted", () => {
    const cfg = validateDetectorConfiguration(valid());
    expect(cfg.processingMode).toBe("auto");
    expect(cfg.maxDetectionsPerFrame).toBe(20);
  });

  it("unknown keys are stripped", () => {
    const stripped = validateDetectorConfiguration({ ...valid(), bogus: true });
    expect("bogus" in stripped).toBe(false);
  });

  it("minimum boundary values accepted", () => {
    const bounds = validateDetectorConfiguration({
      ...valid(),
      confidenceThreshold: 0,
      alertCooldownMs: 0,
      cameraIds: [],
    });
    expect(bounds.confidenceThreshold === 0 && bounds.alertCooldownMs === 0 && bounds.cameraIds.length === 0).toBe(true);
  });

  it("maximum boundary values accepted", () => {
    const maxed = validateDetectorConfiguration({
      ...valid(),
      confidenceThreshold: 100,
      detectionIntervalMs: 600000,
      maxDetectionsPerFrame: 100,
      alertCooldownMs: 3600000,
    });
    expect(maxed.confidenceThreshold === 100 && maxed.detectionIntervalMs === 600000 && maxed.maxDetectionsPerFrame === 100).toBe(true);
  });

  it("confidenceThreshold > 100 rejected", () => {
    expect(() => validateDetectorConfiguration({ ...valid(), confidenceThreshold: 150 })).toThrow();
  });

  it("detectionIntervalMs < 100 rejected", () => {
    expect(() => validateDetectorConfiguration({ ...valid(), detectionIntervalMs: 50 })).toThrow();
  });

  it("unknown alertSeverity rejected", () => {
    expect(() => validateDetectorConfiguration({ ...valid(), alertSeverity: "fatal" })).toThrow();
  });

  it("malformed inputResolution rejected", () => {
    expect(() => validateDetectorConfiguration({ ...valid(), inputResolution: "640" })).toThrow();
  });

  it("unknown processingMode rejected", () => {
    expect(() => validateDetectorConfiguration({ ...valid(), processingMode: "quantum" })).toThrow();
  });

  it("> 100 camera ids rejected", () => {
    expect(() =>
      validateDetectorConfiguration({
        ...valid(),
        cameraIds: Array.from({ length: 101 }, (_, i) => `cam-${i}`),
      }),
    ).toThrow();
  });

  it("hasCamera true for assigned camera", () => {
    const cfg = validateDetectorConfiguration(valid());
    expect(hasCamera(cfg, "demo-camera-1")).toBe(true);
  });

  it("hasCamera false for unassigned camera", () => {
    const cfg = validateDetectorConfiguration(valid());
    expect(hasCamera(cfg, "demo-camera-2")).toBe(false);
  });

  it("withCamera adds an assignment", () => {
    const cfg = validateDetectorConfiguration(valid());
    const added = withCamera(cfg, "demo-camera-2", true);
    expect(hasCamera(added, "demo-camera-2")).toBe(true);
  });

  it("withCamera does not mutate original", () => {
    const cfg = validateDetectorConfiguration(valid());
    withCamera(cfg, "demo-camera-2", true);
    expect(cfg.cameraIds.length).toBe(1);
  });

  it("withCamera dedupes existing assignment", () => {
    const cfg = validateDetectorConfiguration(valid());
    const deduped = withCamera(cfg, "demo-camera-1", true);
    expect(deduped.cameraIds.length).toBe(1);
  });

  it("withCamera removes an assignment", () => {
    const cfg = validateDetectorConfiguration(valid());
    const added = withCamera(cfg, "demo-camera-2", true);
    const removed = withCamera(added, "demo-camera-1", false);
    expect(hasCamera(removed, "demo-camera-1")).toBe(false);
  });
});
