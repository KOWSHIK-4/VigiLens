import { describe, it, expect } from "vitest";
import { deriveDetectionStatus } from "../src/services/detection.service";

describe("Detection Status", () => {
  it("confidence 0.99 -> critical", () => {
    expect(deriveDetectionStatus(0.99)).toBe("critical");
  });

  it("confidence 0.85 (boundary) -> critical", () => {
    expect(deriveDetectionStatus(0.85)).toBe("critical");
  });

  it("confidence 0.84 -> warning", () => {
    expect(deriveDetectionStatus(0.84)).toBe("warning");
  });

  it("confidence 0.6 (boundary) -> warning", () => {
    expect(deriveDetectionStatus(0.6)).toBe("warning");
  });

  it("confidence 0.59 -> info", () => {
    expect(deriveDetectionStatus(0.59)).toBe("info");
  });

  it("confidence 0 -> info", () => {
    expect(deriveDetectionStatus(0.0)).toBe("info");
  });
});
