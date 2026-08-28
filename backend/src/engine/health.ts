/**
 * Detector Engine v2 — Merged Detector Health.
 *
 * Combines the base detector health (DB-derived status, uptime, camera
 * assignments) with the engine's measured health (real latency, processed
 * frame counts, lifecycle status, last error). Lives in the engine module
 * so it can import the engine service without creating a circular
 * dependency (engine -> detectorService is already an established edge).
 */

import { detectorService } from "../services/detector.service";
import { engineService } from "./engineService";

export interface MergedDetectorHealth {
  id: string;
  name: string;
  detectorKey: string;
  status: "running" | "stopped" | "error";
  healthy: boolean;
  message: string;
  latencyMs: number | null;
  uptimeSeconds: number;
  lastHealthCheck: string;
  assignedCameras: number;
  framesProcessed: number | null;
  throughputFps: number | null;
  /** Engine-level detail: lifecycle status, reachability, last error. */
  engine: Record<string, unknown>;
}

function mapEngineStatusToDetectorStatus(engineStatus: string, baseStatus: "running" | "stopped" | "error") {
  if (engineStatus === "ready" || engineStatus === "configured") return "running";
  if (engineStatus === "error") return "error";
  return baseStatus;
}

/**
 * Returns the merged health for a detector. Engine values (real, measured)
 * replace the base estimates only when engine runs exist; otherwise the
 * documented base estimates are kept.
 */
export async function getMergedDetectorHealth(id: string): Promise<MergedDetectorHealth> {
  const base = await detectorService.health(id);
  const engine = await engineService.getHealth(base.detectorKey);

  if (!engine) {
    return { ...base, engine: null as unknown as Record<string, unknown> };
  }

  return {
    ...base,
    status: mapEngineStatusToDetectorStatus(engine.status, base.status),
    healthy: engine.healthy,
    message: engine.message,
    latencyMs: engine.latencyMs ?? base.latencyMs,
    framesProcessed: engine.framesProcessed,
    throughputFps: engine.throughputFps,
    engine,
  };
}
