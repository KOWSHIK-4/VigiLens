/**
 * Explainable risk scoring — pure unit tests.
 *
 * The score must be deterministic, bounded 0–100, built from additive
 * factors, and each factor must explain itself. Existing severity must not
 * leak into the score beyond its own 10-point factor.
 */

import { describe, expect, it } from "vitest";
import {
  computeRiskScore,
  severityWeight,
  classTierWeight,
  type RiskContext,
} from "../src/services/riskScore";

const emptyContext = (): RiskContext => ({
  maxConfidence: 0,
  detectionCount: 1,
  correlatedEventCount: 0,
  crossCameraSequenceCount: 0,
  recentAlertCount: 0,
  activeIncidentCount: 0,
  alertSeverity: "",
});

describe("severityWeight", () => {
  it("ranks critical above warning above info above none", () => {
    expect(severityWeight("critical")).toBeGreaterThan(severityWeight("warning"));
    expect(severityWeight("warning")).toBeGreaterThan(severityWeight("info"));
    expect(severityWeight("info")).toBeGreaterThan(severityWeight(""));
  });
});

describe("classTierWeight", () => {
  it("ranks the configured tiers", () => {
    expect(classTierWeight("high")).toBeGreaterThan(classTierWeight("elevated"));
    expect(classTierWeight("elevated")).toBeGreaterThan(classTierWeight("default"));
  });
});

describe("computeRiskScore", () => {
  it("returns 0 for empty context with zeroed factors", () => {
    const score = computeRiskScore(emptyContext());
    expect(score.riskScore).toBe(0);
    expect(score.level).toBe("low");
    expect(score.factors.every((f) => f.contribution === 0)).toBe(true);
    expect(score.factors.length).toBe(8);
  });

  it("is deterministic for identical context", () => {
    const context = {
      ...emptyContext(),
      maxConfidence: 0.9,
      detectionCount: 6,
      correlatedEventCount: 2,
      crossCameraSequenceCount: 1,
      alertSeverity: "critical" as const,
    };
    const first = computeRiskScore(context);
    const second = computeRiskScore(context);
    expect(second).toEqual(first);
  });

  it("bounded in [0, 100] even on maximal input", () => {
    const score = computeRiskScore({
      ...emptyContext(),
      maxConfidence: 1,
      detectionCount: 50,
      correlatedEventCount: 10,
      crossCameraSequenceCount: 5,
      recentAlertCount: 100,
      activeIncidentCount: 10,
      alertSeverity: "critical",
      temporalConcentration: true,
      detectorClassRiskTier: "high",
    });
    expect(score.riskScore).toBeLessThanOrEqual(100);
    expect(score.riskScore).toBeGreaterThanOrEqual(0);
    expect(score.level).toBe("high");
  });

  it("scores each factor within its weight cap", () => {
    const score = computeRiskScore(emptyContext());
    const weights: Record<string, number> = {
      detection_confidence: 30,
      detection_recurrence: 25,
      correlated_activity: 15,
      cross_camera_activity: 15,
      temporal_concentration: 10,
      active_incident: 10,
      alert_severity: 10,
      detector_class_risk: 5,
    };
    for (const factor of score.factors) {
      expect(factor.contribution).toBeLessThanOrEqual(weights[factor.name]!);
    }
  });

  it("scores repeated activity higher than a single event", () => {
    const single = computeRiskScore({ ...emptyContext(), maxConfidence: 0.9, detectionCount: 1 });
    const repeated = computeRiskScore({ ...emptyContext(), maxConfidence: 0.9, detectionCount: 6 });
    expect(repeated.riskScore).toBeGreaterThan(single.riskScore);
    expect(
      repeated.factors.find((f) => f.name === "detection_recurrence")!.reason,
    ).toContain("6 detections");
  });

  it("cross-camera context increases the score and is explained", () => {
    const alone = computeRiskScore(emptyContext());
    const fleet = computeRiskScore({ ...emptyContext(), crossCameraSequenceCount: 2 });
    expect(fleet.riskScore).toBeGreaterThan(alone.riskScore);
    const factor = fleet.factors.find((f) => f.name === "cross_camera_activity")!;
    expect(factor.reason).toContain("2 cross-camera sequence(s)");
  });

  it("existing alert severity contributes only its own 10-point factor", () => {
    const none = computeRiskScore(emptyContext());
    const critical = computeRiskScore({ ...emptyContext(), alertSeverity: "critical" });
    expect(critical.riskScore - none.riskScore).toBe(10);
  });

  it("handles adversarial input without throwing", () => {
    const score = computeRiskScore({
      ...emptyContext(),
      maxConfidence: Number.NaN,
      detectionCount: Number.POSITIVE_INFINITY,
      correlatedEventCount: -5,
      crossCameraSequenceCount: Number.NaN,
    });
    expect(score.riskScore).toBeGreaterThanOrEqual(0);
    expect(score.riskScore).toBeLessThanOrEqual(100);
  });
});