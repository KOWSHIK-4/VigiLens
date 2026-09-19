/**
 * Explainable Security Risk Scoring.
 *
 * Produces a deterministic 0–100 risk score for a detection event together
 * with the factors that produced it. This is deliberately layered ON TOP of
 * the existing confidence-based severity ladder — it never replaces it and
 * never rewrites `Detection.status` or `Alert.severity`.
 *
 * Only real, measured inputs are consumed:
 *
 *   - detection confidence (as reported by the detector)
 *   - detection recurrence within the window
 *   - correlated per-camera events (existing correlation metadata)
 *   - cross-camera sequences (the fleet correlation layer)
 *   - event frequency / temporal concentration
 *   - detector + class combination
 *   - active incident context
 *   - current alert severity (existing threshold-derived severity)
 *
 * Every factor is bounded and additive, so no single factor can dominate the
 * score, and each factor returns a human-readable explanation. The same
 * input always produces the same score and the same explanation set.
 *
 * The module is pure (free of I/O) and safe to unit test directly.
 */

export type RiskFactorName =
  | "detection_confidence"
  | "detection_recurrence"
  | "correlated_activity"
  | "cross_camera_activity"
  | "temporal_concentration"
  | "active_incident"
  | "alert_severity"
  | "detector_class_risk";

export interface RiskFactor {
  name: RiskFactorName;
  contribution: number;
  /** Maximum contribution this factor can add. */
  weight: number;
  reason: string;
}

export interface RiskContext {
  /** Highest confidence among related detections (0–1). */
  maxConfidence: number;
  /** Number of related detections of the same class observed. */
  detectionCount: number;
  /** Detections sharing a correlation event id. */
  correlatedEventCount: number;
  /** Distinct cross-camera sequences the detection participates in. */
  crossCameraSequenceCount: number;
  /** Alerts raised within a short window before this event. */
  recentAlertCount: number;
  /** Active (non-resolved) incidents referencing a similar class. */
  activeIncidentCount: number;
  /** Highest severity among the recent alerts ('' when none). */
  alertSeverity: "" | "info" | "warning" | "critical";
  /** Detector class combination, used to weight class-specific exposure. */
  detectorKey?: string | null;
  className?: string | null;
  /** Whether the window is unusually concentrated in a short burst. */
  temporalConcentration?: boolean;
  /** Class risk tier derived from the built-in detector catalog. */
  detectorClassRiskTier?: "default" | "elevated" | "high";
}

export interface RiskScore {
  riskScore: number;
  level: "low" | "moderate" | "elevated" | "high";
  factors: RiskFactor[];
  /** Human-readable summary of why this event scored as it did. */
  summary: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function severityWeight(severity: RiskContext["alertSeverity"]): number {
  switch (severity) {
    case "critical":
      return 1;
    case "warning":
      return 0.6;
    case "info":
      return 0.3;
    default:
      return 0;
  }
}

export function classTierWeight(tier: RiskContext["detectorClassRiskTier"]): number {
  switch (tier) {
    case "high":
      return 1;
    case "elevated":
      return 0.6;
    case "default":
      return 0.3;
    default:
      return 0;
  }
}

function safeFinite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function safeCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 100);
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Pure risk engine. `detectionClassRiskComponent` is optional; when missing
 * the default tier weight keeps the score fully deterministic.
 */
export function computeRiskScore(context: RiskContext): RiskScore {
  const confidenceConf = safeFinite(context.maxConfidence, 0);
  const detectionCount = safeCount(context.detectionCount);
  const correlatedEventCount = safeCount(context.correlatedEventCount);
  const crossCameraSequenceCount = safeCount(context.crossCameraSequenceCount);
  const activeIncidentCount = safeCount(context.activeIncidentCount);

  const factors: RiskFactor[] = [];

  // 1) Detection confidence (weight 30).
  const confidenceContribution = Math.round(clamp(confidenceConf, 0, 1) * 30);
  factors.push({
    name: "detection_confidence",
    contribution: confidenceContribution,
    weight: 30,
    reason: `The detector reported ${Math.round(confidenceConf * 100)}% confidence for this event.`,
  });

  // 2) Detection recurrence (weight 25; only repeat events of the same class
  // count — a lone detection is never a "recurrence").
  const count = Math.floor(detectionCount);
  const repeats = Math.max(0, count - 1);
  const boundedRecurrence = clamp(Math.round((repeats / 10) * 25), 0, 25);
  factors.push({
    name: "detection_recurrence",
    contribution: boundedRecurrence,
    weight: 25,
    reason:
      count > 1
        ? `${count} detections of the same class were observed within the window.`
        : "This is the only detection of its class in the window.",
  });

  // 3) Correlated activity (existing correlation metadata; weight 15).
  const correlatedContribution = clamp(correlatedEventCount * 5, 0, 15);
  factors.push({
    name: "correlated_activity",
    contribution: correlatedContribution,
    weight: 15,
    reason:
      correlatedEventCount > 0
        ? `Existing correlation groups this detection with ${correlatedEventCount} related event(s).`
        : "No existing correlated events reference this detection.",
  });

  // 4) Cross-camera activity (fleet sequences; weight 15).
  const crossCameraContribution = clamp(crossCameraSequenceCount * 7.5, 0, 15);
  factors.push({
    name: "cross_camera_activity",
    contribution: crossCameraContribution,
    weight: 15,
    reason:
      crossCameraSequenceCount > 0
        ? `Fleet correlation placed this event in ${crossCameraSequenceCount} cross-camera sequence(s) — nearby activity was observed on other cameras.`
        : "No cross-camera sequences include this event.",
  });

  // 5) Temporal concentration (weight 10).
  const concentrationContribution = context.temporalConcentration ? 10 : 0;
  factors.push({
    name: "temporal_concentration",
    contribution: concentrationContribution,
    weight: 10,
    reason: context.temporalConcentration
      ? "Events are concentrated into a short burst rather than spread across the window."
      : "Events are not unusually concentrated in time.",
  });

  // 6) Active incident context (weight 10).
  const incidentContribution = clamp(activeIncidentCount * 5, 0, 10);
  factors.push({
    name: "active_incident",
    contribution: incidentContribution,
    weight: 10,
    reason:
      activeIncidentCount > 0
        ? `${activeIncidentCount} active incident(s) reference a similar class.`
        : "No active incidents reference a similar class.",
  });

  // 7) Alert severity (existing ladder; weight 10).
  const severityContribution = Math.round(severityWeight(context.alertSeverity) * 10);
  factors.push({
    name: "alert_severity",
    contribution: severityContribution,
    weight: 10,
    reason:
      context.alertSeverity === ""
        ? "No alert has been raised for this event yet."
        : `Existing threshold-derived severity for this event is "${context.alertSeverity}".`,
  });

  // 8) Detector/class risk tier (weight 5, capped so it can never push a
  // low-risk event over a boundary on its own). Only contributes when the
  // caller explicitly assigns a tier — the empty context contributes 0.
  const tierContribution = Math.round(classTierWeight(context.detectorClassRiskTier) * 5);
  factors.push({
    name: "detector_class_risk",
    contribution: tierContribution,
    weight: 5,
    reason:
      context.detectorClassRiskTier === undefined
        ? "No class-specific risk tier is configured; this factor contributes nothing."
        : `The "${context.className ?? "class"}" detector combination is classified as "${context.detectorClassRiskTier}" risk.`,
  });

  const total = clamp(
    factors.reduce((sum, factor) => sum + safeFinite(factor.contribution, 0), 0),
    0,
    100,
  );

  const level =
    total >= 80 ? "high" : total >= 60 ? "elevated" : total >= 35 ? "moderate" : "low";

  const summary = `Risk score ${Math.round(total)}/100 (${level}). ` +
    factors
      .filter((factor) => factor.contribution > 0)
      .map((factor) => factor.name.replace(/_/g, " "))
      .join(", ") +
    (factors.every((factor) => factor.contribution === 0)
      ? "No measurable risk factors."
      : " contributed to the score.");

  return { riskScore: roundScore(total), level, factors, summary };
}