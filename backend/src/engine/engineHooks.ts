/**
 * Detector Engine v2 — Engine Hooks.
 *
 * Decoupled notification channel so lifecycle events that live outside the
 * engine (e.g. `detectorService.restart`) can reset engine-owned runtime
 * state (persistent object trackers) without creating an import cycle.
 */

import { logger } from "@/config/logger";

type EngineRestartListener = () => void;

const restartListeners = new Set<EngineRestartListener>();

/** Subscribe a callback invoked whenever a detector (re)starts. */
export function onDetectorRestart(listener: EngineRestartListener): void {
  restartListeners.add(listener);
}

/** Notify listeners that a detector has restarted. */
export function notifyDetectorRestart(): void {
  for (const listener of restartListeners) {
    try {
      listener();
    } catch (err) {
      logger.warn("Detector restart listener failed", { err });
    }
  }
}
