/**
 * Cross-Camera Fleet Correlation.
 *
 * The existing per-camera correlation (`correlation.ts`) groups detections
 * that share a (camera, detector, class) bucket. This layer answers a
 * different question that the per-camera engine cannot: when activity on
 * camera A is quickly followed by activity of the same class on camera B,
 * are these *related events* worth looking at as one sequence?
 *
 * It is deliberately NOT an identity engine. Two detections on different
 * cameras are never claimed to be the same person or vehicle unless the
 * tracking metadata genuinely supports it (shared track id across feeds,
 * which only multi-stream decoders produce). The conservative vocabulary is
 * "related event", "cross-camera sequence" and "possible movement".
 *
 * Rules that keep this deterministic and safe:
 *
 *   - A "related group" is formed per (detector, class, epoch-aligned time
 *     bucket). Camera is intentionally NOT part of the group key so different
 *     cameras can join, but the same class/detector rule from the per-camera
 *     engine still applies (no cross-class merging).
 *   - The sequence id is a deterministic hash of (detector, class, bucket),
 *     so re-processing the same window always yields the same sequences and
 *     no duplicate ids can be produced by arrival order.
 *   - A sequence needs detections from at least two distinct cameras within
 *     the window boundary, and each camera must contribute at least one row.
 *   - The correlation window is bounded (`windowMs`) and aligns to the same
 *     epoch buckets used by the per-camera engine, so a stale or replayed
 *     window cannot grow without bound.
 *   - cameras that are not in the detected set never appear in output, and
 *     each output sequence carries only the camera ids actually present.
 *
 * The layer is pure: no database access, no side effects. The caller loads
 * the window of detections and gets back the sequence summary.
 */

import { createHash } from "node:crypto";

/** Default fleet window: 5 minutes of epoch-aligned buckets. */
export const FLEET_DEFAULT_WINDOW_MS = 5 * 60 * 1000;
/** Hard upper bound so callers cannot request an unbounded window. */
export const FLEET_MAX_WINDOW_MS = 60 * 60 * 1000;
/** A sequence is only reported once two distinct cameras participate. */
export const FLEET_MIN_CAMERAS = 2;

export interface FleetDetectionInput {
  id: string;
  cameraId: string;
  cameraName?: string | null;
  detectorKey: string | null;
  className: string | null;
  label: string;
  confidence: number;
  timestamp: Date;
  trackId: string | null;
  /** Optional flag set by the pre-existing per-camera correlation layer. */
  correlation?: { eventId?: string } | null;
}

export interface CrossCameraSequence {
  sequenceId: string;
  relationship: "related_event";
  /** Conservative: "possible movement" only when the window is short. */
  possibleMovement: boolean;
  groupKey: string;
  detectorKey: string | null;
  className: string | null;
  /** Distinct cameras that actually participated. */
  cameraIds: string[];
  cameraNames: Array<{ cameraId: string; name: string }>;
  detectionCount: number;
  detectionIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  windowMs: number;
  /** Capacity-safe note about whether identity can be inferred. */
  identity: "not_inferred";
  reason: string;
}

/**
 * Epoch-aligned bucket start, identical in spirit to the per-camera engine's
 * `eventBucketStart` so both layers can share timestamps if needed.
 */
export function fleetBucketStart(timestampMs: number, windowMs: number): number {
  return Math.floor(timestampMs / windowMs) * windowMs;
}

function isValidRow(row: FleetDetectionInput): boolean {
  return Boolean(
    row.id &&
      row.cameraId &&
      (row.className || row.label) &&
      row.timestamp instanceof Date &&
      Number.isFinite(row.confidence),
  );
}

function sequenceIdFor(groupKey: string, bucketStartMs: number): string {
  const digest = createHash("sha1")
    .update(`fleet:${groupKey}:${bucketStartMs}`)
    .digest("hex");
  return `seq-${digest.slice(0, 12)}`;
}

/**
 * Pure correlation pass. Returns an ordered list of cross-camera sequences.
 * The list is deterministic for identical input because rows are sorted by
 * (bucket, group key, first timestamp, id) before grouping.
 */
export function correlateFleet(
  detections: FleetDetectionInput[],
  windowMs: number = FLEET_DEFAULT_WINDOW_MS,
  now = new Date(),
): CrossCameraSequence[] {
  if (!Number.isFinite(windowMs) || windowMs <= 0 || windowMs > FLEET_MAX_WINDOW_MS) {
    throw new Error(
      `Fleet correlation window must be between 1ms and ${FLEET_MAX_WINDOW_MS}ms`,
    );
  }

  const clean = detections.filter(isValidRow);
  if (clean.length < FLEET_MIN_CAMERAS) return [];

  const bucketStart = now.getTime() - windowMs;

  const groups = new Map<string, FleetDetectionInput[]>();
  for (const row of clean) {
    // Only inspect rows inside the requested window — no unbounded history.
    if (row.timestamp.getTime() < bucketStart || row.timestamp.getTime() > now.getTime()) {
      continue;
    }
    const detectorKey = row.detectorKey ?? "unknown";
    const className = row.className ?? row.label;
    const bucket = fleetBucketStart(row.timestamp.getTime(), windowMs);
    const key = `${detectorKey}|${className}|${bucket}`;
    const members = groups.get(key) ?? [];
    members.push(row);
    groups.set(key, members);
  }

  const sequences: CrossCameraSequence[] = [];

  for (const [key, members] of groups) {
    const [detectorKey, className] = key.split("|");
    const bucketStartMs = Number(key.split("|")[2]);
    const distinctCameras = [...new Set(members.map((m) => m.cameraId))];
    if (distinctCameras.length < FLEET_MIN_CAMERAS) continue;

    const ordered = [...members].sort(
      (a, b) =>
        a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id),
    );

    // Neither identity nor movement direction is inferred from this API.
    // "possible movement" is a conservative label for a sequence whose
    // detections are nearby in time across distinct cameras, never a claim
    // that a single subject moved between the cameras.
    const spanMs = ordered[ordered.length - 1].timestamp.getTime() - ordered[0].timestamp.getTime();
    const possibleMovement = spanMs <= windowMs;

    const cameraNames = distinctCameras.map((cameraId) => {
      const row = ordered.find((m) => m.cameraId === cameraId);
      return { cameraId, name: row?.cameraName ?? cameraId };
    });

    sequences.push({
      sequenceId: sequenceIdFor(key, bucketStartMs),
      relationship: "related_event",
      possibleMovement,
      groupKey: key,
      detectorKey,
      className,
      cameraIds: distinctCameras,
      cameraNames,
      detectionCount: ordered.length,
      detectionIds: ordered.map((m) => m.id),
      firstSeenAt: ordered[0].timestamp.toISOString(),
      lastSeenAt: ordered[ordered.length - 1].timestamp.toISOString(),
      windowMs,
      identity: "not_inferred",
      reason: `${ordered.length} ${className} detection${ordered.length === 1 ? "" : "s"} on ${distinctCameras.length} cameras (${distinctCameras.join(", ")}) fell within one ${Math.round(windowMs / 1000)}s bucket; treated as a related cross-camera sequence — no identity between them is inferred.`,
    });
  }

  sequences.sort(
    (a, b) =>
      a.firstSeenAt.localeCompare(b.firstSeenAt) ||
      a.sequenceId.localeCompare(b.sequenceId),
  );

  return sequences;
}