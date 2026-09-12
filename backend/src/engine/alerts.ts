/**
 * Detector Engine v2 — Alert Evaluation.
 *
 * Raises alerts for qualifying detections with per-detector cooldown:
 * at most one alert per (detector, camera, class) within the configured
 * `alertCooldownMs`. The cooldown registry is shared across pipeline
 * runs so repeated frames do not flood the alert queue.
 */

import { logger } from "../config/logger";
import { alertService } from "../services/alert.service";
import { logAudit } from "../utils/auditLog";
import { correlationMessageSuffix } from "../services/correlation";
import type { AlertSeverity } from "@prisma/client";
import type { AlertEvaluationStage } from "./pipeline";
import type { NormalizedDetection, PipelineContext } from "./types";

/** Matches `deriveDetectionStatus` thresholds in `detection.service` so event
 *  severity stays consistent between plain detections and raised alerts. */
const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

function confidenceSeverity(confidence: number): AlertSeverity {
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.6) return "warning";
  return "info";
}

export class AlertCooldownRegistry {
  private readonly lastAlert = new Map<string, number>();
  /** Entries idle this long can never be within a configured cooldown window. */
  private static readonly MAX_ENTRY_TTL_MS = 60 * 60 * 1000;
  /** Start pruning once the map holds at least this many keys. */
  private static readonly PRUNE_AT_KEYS = 1000;
  /** Only scan when at least this many records were added since the last prune. */
  private static readonly PRUNE_EVERY_RECORDS = 256;
  private recordsSincePrune = 0;

  /** True if (key, now) passes the cooldown and should raise an alert. */
  shouldRaise(key: string, now: number, cooldownMs: number): boolean {
    const last = this.lastAlert.get(key) ?? 0;
    return now - last >= cooldownMs;
  }

  record(key: string, now: number): void {
    this.lastAlert.set(key, now);
    this.maybePrune(now);
  }

  /** Drops entries idle longer than `olderThanMs`, bounding the map's growth. */
  prune(now: number = Date.now(), olderThanMs: number = AlertCooldownRegistry.MAX_ENTRY_TTL_MS): number {
    let removed = 0;
    for (const [key, last] of this.lastAlert) {
      if (now - last >= olderThanMs) {
        this.lastAlert.delete(key);
        removed += 1;
      }
    }
    this.recordsSincePrune = 0;
    return removed;
  }

  private maybePrune(now: number): void {
    this.recordsSincePrune += 1;
    if (this.lastAlert.size >= AlertCooldownRegistry.PRUNE_AT_KEYS &&
        this.recordsSincePrune >= AlertCooldownRegistry.PRUNE_EVERY_RECORDS) {
      this.prune(now);
    }
  }

  reset(): void {
    this.lastAlert.clear();
    this.recordsSincePrune = 0;
  }
}

/** Shared cooldown registry used by both the engine pipeline and M2M ingestion. */
export const sharedAlertCooldownRegistry = new AlertCooldownRegistry();

export class CooldownAlertStage implements AlertEvaluationStage {
  readonly name = "alerts";
  private readonly registry: AlertCooldownRegistry;

  constructor(registry: AlertCooldownRegistry = new AlertCooldownRegistry()) {
    this.registry = registry;
  }

  async evaluate(detections: NormalizedDetection[], ctx: PipelineContext): Promise<void> {
    const cooldownMs = ctx.detector.configuration.alertCooldownMs;
    const now = Date.now();

    for (const d of detections) {
      if (!d.id) continue;

      const key = `${d.detectorKey}:${d.cameraId}:${d.className}`;
      if (!this.registry.shouldRaise(key, now, cooldownMs)) continue;

      // Escalate so the most severe of the detector's default and the
      // event's per-detection confidence wins.
      const configured = ctx.detector.configuration.alertSeverity;
      const derived = confidenceSeverity(d.confidence);
      const severity =
        SEVERITY_RANK[derived] > SEVERITY_RANK[configured] ? derived : configured;
      const title = `${ctx.detector.name}: ${d.className}`;
      const message =
        `${d.className} detected on camera ${d.cameraId} with ${(d.confidence * 100).toFixed(1)}% confidence.` +
        correlationMessageSuffix(d.correlation);

      try {
        const alert = await alertService.create({
          detectionId: d.id,
          severity,
          title,
          message,
        });
        await logAudit({
          action: "alert_created",
          module: "alerts",
          description: `Alert created: ${title}`,
          metadata: { alertId: alert.id, detectionId: d.id, severity },
        });
        this.registry.record(key, now);
      } catch (err) {
        logger.warn("Failed to raise alert", { key, err });
      }
    }
  }
}
