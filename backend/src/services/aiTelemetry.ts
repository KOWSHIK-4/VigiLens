/**
 * AI telemetry aggregation.
 *
 * Consumes ONLY genuinely measured inputs — metrics service snapshots,
 * model-test probe counters, detection pipeline latency samples and the
 * registered model registry — and turns them into an explainable summary.
 *
 * Accuracy/precision/recall are NEVER synthesised: they surface only when a
 * labelled ground-truth set exists (supported/configured externally), and
 * otherwise are reported as `null` with an explicit "unavailable" reason.
 * A missing AI service under active experiments simply becomes `unavailable`
 * (a pipeline status), never an accuracy figure.
 */

export type AITelemetryStatus = "ok" | "degraded" | "unavailable" | "not_configured";

export interface AITelemetryInput {
  /** Successful model-test probe inferences. */
  testSuccessCount: number;
  /** Failed model-test probe inferences. */
  testFailureCount: number;
  /** Real detection-pipeline latency average (ms) from the metrics service. */
  averageLatencyMs: number;
  /** Real detection samples currently tracked by the metrics service. */
  latencySampleCount: number;
  /** Registered models in the catalog. */
  registeredModelCount: number;
  /** Models loaded for inference (enabled + loaded). */
  activeModelCount: number;
  engineModelNames: string[];
  /** Real detection rows created in the recent retention window. */
  recentDetectionCount: number;
  /** Process uptime in milliseconds. */
  uptimeMs: number;
  /** Labeled ground-truth records for measured quality metrics (0 = none). */
  labeledRecords?: number;
  /** Correctly matched labeled records (only meaningful with labeledRecords > 0). */
  labeledCorrect?: number;
}

export interface AITelemetrySummary {
  status: AITelemetryStatus;
  collectedAt: string;
  modelHealth: {
    registeredModels: number;
    activeModels: number;
    engineModels: string[];
  };
  inference: {
    probeSuccessCount: number;
    probeFailureCount: number;
    probeTotal: number;
    successRate: number;
    lastProbeOutcome: "succeeded" | "failed" | "no_probe";
  };
  pipeline: {
    recentDetectionCount: number;
    averageLatencyMs: number;
    /** Null when no latency distribution is tracked (average-only data). */
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    maxLatencyMs: number | null;
    sampleCount: number;
  };
  accuracy: {
    precision: number | null;
    recall: number | null;
    accuracy: number | null;
    f1Score: number | null;
    fromLabeledRecords: number;
    reason: string;
  };
  uptimeSeconds: number;
}

export function aggregateAITelemetry(input: AITelemetryInput): AITelemetrySummary {
  const averageLatency =
    Number.isFinite(input.averageLatencyMs) && input.averageLatencyMs >= 0
      ? input.averageLatencyMs
      : 0;
  const sampleCount = Math.max(0, input.latencySampleCount);

  const probeTotal = input.testSuccessCount + input.testFailureCount;
  const lastProbeOutcome =
    input.testFailureCount > 0
      ? "failed"
      : input.testSuccessCount > 0
        ? "succeeded"
        : "no_probe";
  const successRate =
    probeTotal > 0 ? input.testSuccessCount / probeTotal : 0;

  const labeled = Math.max(0, input.labeledRecords ?? 0);
  const correct = Math.max(0, input.labeledCorrect ?? 0);
  const hasGroundTruth = labeled > 0 && correct <= labeled;
  const accuracy = hasGroundTruth ? correct / labeled : null;

  // No ground-truth distribution data exists without an external labelled
  // set, so precision/recall/f1 remain null — reported as unexplainable
  // rather than invented.
  const precision = null;
  const recall = null;
  const f1Score = null;

  const registeredModelCount = Math.max(0, input.registeredModelCount);
  const activeModelCount = Math.max(0, input.activeModelCount);

  let status: AITelemetryStatus = "not_configured";
  if (registeredModelCount > 0 && activeModelCount > 0) {
    status = input.testFailureCount > 0 ? "degraded" : "ok";
  } else if (registeredModelCount > 0) {
    status = "unavailable";
  }

  return {
    status,
    collectedAt: new Date().toISOString(),
    modelHealth: {
      registeredModels: registeredModelCount,
      activeModels: activeModelCount,
      engineModels: [...input.engineModelNames],
    },
    inference: {
      probeSuccessCount: input.testSuccessCount,
      probeFailureCount: input.testFailureCount,
      probeTotal,
      successRate: Math.round(successRate * 1000) / 1000,
      lastProbeOutcome,
    },
    pipeline: {
      recentDetectionCount: input.recentDetectionCount,
      averageLatencyMs: Math.round(averageLatency * 100) / 100,
      p50LatencyMs: null,
      p95LatencyMs: null,
      maxLatencyMs: null,
      sampleCount,
    },
    accuracy: {
      precision,
      recall,
      accuracy,
      f1Score,
      fromLabeledRecords: labeled,
      reason: hasGroundTruth
        ? `Accuracy ${Math.round((accuracy ?? 0) * 100)}% is measured against ${labeled} labeled ground-truth records. Precision/recall/f1 require per-class confusion data, which this deployment does not yet collect.`
        : "No labeled ground-truth set is configured, so accuracy/precision/recall are not reported (they are never approximated).",
    },
    uptimeSeconds: Math.max(0, input.uptimeMs) / 1000,
  };
}