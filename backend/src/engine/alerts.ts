/**
 * Detector Engine v2 — Alert Evaluation.
 *
 * Raises alerts for qualifying detections with per-detector cooldown:
 * at most one alert per (detector, camera, class) within the configured
 * `alertCooldownMs`. The cooldown registry is shared across pipeline
 * runs so repeated frames do not flood the alert queue.
 */

import { logger } from "@/config/logger";
import { alertService } from "@/services/alert.service";
import type { AlertEvaluationStage } from "./pipeline";
import type { NormalizedDetection, PipelineContext } from "./types";

export class AlertCooldownRegistry {
  private readonly lastAlert = new Map<string, number>();

  /** True if (key, now) passes the cooldown and should raise an alert. */
  shouldRaise(key: string, now: number, cooldownMs: number): boolean {
    const last = this.lastAlert.get(key) ?? 0;
    return now - last >= cooldownMs;
  }

  record(key: string, now: number): void {
    this.lastAlert.set(key, now);
  }

  reset(): void {
    this.lastAlert.clear();
  }
}

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

      const severity = ctx.detector.configuration.alertSeverity;
      const title = `${ctx.detector.name}: ${d.className}`;
      const message = `${d.className} detected on camera ${d.cameraId} with ${(d.confidence * 100).toFixed(1)}% confidence.`;

      try {
        await alertService.create({
          detectionId: d.id,
          severity,
          title,
          message,
        });
        this.registry.record(key, now);
      } catch (err) {
        logger.warn("Failed to raise alert", { key, err });
      }
    }
  }
}
