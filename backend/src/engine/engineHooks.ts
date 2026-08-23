/**
 * Detector Engine v2 — Engine Hooks.
 *
 * Decoupled notification channel so lifecycle events that live outside the
 * engine (e.g. `detectorService.restart`) can reset engine-owned runtime
 * state (persistent object trackers) without creating an import cycle.
 */

import { logger } from "@/config/logger";

/**
 * Listener invoked when a detector restarts. Receives the detector key that
 * restarted, or `undefined` when every detector's runtime state should be
 * dropped (process-wide resets).
 */
type EngineRestartListener = (key?: string) => void;

const restartListeners = new Set<EngineRestartListener>();

/** Subscribe a callback invoked whenever a detector (re)starts. */
export function onDetectorRestart(listener: EngineRestartListener): void {
  restartListeners.add(listener);
}

/**
 * Notify listeners that a detector has restarted. Pass the detector key so
 * listeners can scope their cleanup to that detector; omit it to request a
 * process-wide reset.
 */
export function notifyDetectorRestart(key?: string): void {
  for (const listener of restartListeners) {
    try {
      listener(key);
    } catch (err) {
      logger.warn("Detector restart listener failed", { err });
    }
  }
}

