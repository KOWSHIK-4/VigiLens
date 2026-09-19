import type { CameraStatus } from "@prisma/client";

/**
 * A reliability summary for a single camera computed from its health-log rows.
 * `healthyChecks` counts rows recorded as healthy inside the window so the
 * fleet overview can report honest, measured availability instead of a guessed
 * number when a camera has not been probed often enough.
 */
export interface CameraReliability {
  healthyChecks: number;
  totalChecks: number;
  availabilityPct: number | null;
  avgResponseTimeMs: number | null;
  lastStatus: CameraStatus | null;
  lastCheckedAt: string | null;
}

/**
 * A single row from the camera health log fed into the summary. Maps directly
 * onto the health-log projection a fleet overview query would return.
 */
export interface CameraFleetReliabilityRow {
  cameraId: string;
  status: CameraStatus;
  responseTime: number | null;
  checkedAt: Date;
}

/**
 * Summarizes one camera's health-log rows inside a rolling window. Availability
 * is the share of healthy checks; it is `null` when the camera has no checks
 * in the window (data withheld rather than assumed healthy). Pure and free of
 * I/O so it can be unit tested directly.
 */
export function summarizeCameraReliability(
  rows: CameraFleetReliabilityRow[],
  windowMs: number,
  now = new Date(),
): CameraReliability {
  const windowStart = new Date(now.getTime() - windowMs);
  const inWindow = rows.filter(
    (r) => r.checkedAt >= windowStart && r.checkedAt <= now,
  );

  const totalChecks = inWindow.length;
  const healthyChecks = inWindow.filter(
    (r) => r.status === "online",
  ).length;

  const availabilityPct =
    totalChecks === 0 ? null : (healthyChecks / totalChecks) * 100;

  const completed = inWindow.filter((r) => r.responseTime != null);
  const avgResponseTimeMs =
    completed.length === 0
      ? null
      : completed.reduce((sum, r) => sum + (r.responseTime ?? 0), 0) /
        completed.length;

  let lastStatus: CameraStatus | null = null;
  let lastCheckedAt: Date | null = null;
  for (const r of inWindow) {
    if (lastCheckedAt === null || r.checkedAt > lastCheckedAt) {
      lastCheckedAt = r.checkedAt;
      lastStatus = r.status;
    }
  }

  return {
    healthyChecks,
    totalChecks,
    availabilityPct,
    avgResponseTimeMs,
    lastStatus,
    lastCheckedAt: lastCheckedAt?.toISOString() ?? null,
  };
}
