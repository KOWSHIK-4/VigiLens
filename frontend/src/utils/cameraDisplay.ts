import type { Camera, CameraDisplayStatus } from "@/types";

/**
 * A camera's real state is only known once it has been verified by a health
 * check or a snapshot capture. The backend provides `displayStatus` for this;
 * as a fallback, cameras without a `lastHealthCheck` are reported as
 * "unknown" instead of trusting `status`/`isHealthy` that were never set.
 */
export function resolveDisplayStatus(camera: Camera): CameraDisplayStatus {
  if (camera.displayStatus) return camera.displayStatus;
  return camera.lastHealthCheck ? camera.status : "unknown";
}