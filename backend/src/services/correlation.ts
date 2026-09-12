/**
 * Detection Event Correlation.
 *
 * The objective is to identify when multiple detections likely belong to the
 * same security event so the system can treat a burst of activity as one
 * meaningful event instead of a pile of unrelated detections.
 *
 * Grouping is deliberately conservative, deterministic and explainable:
 *
 *   - The correlation window reuses the detector's configured
 *     `alertCooldownMs` (falling back to the engine default of 30s). The
 *     alert engine already uses that same window to throttle per-
 *     (detector, camera, class) alerts, so detections that belong to one
 *     alert window belong to one event.
 *   - Detections are bucketed into fixed, epoch-aligned time windows of
 *     `windowMs`. The resulting event id depends only on
 *     (camera, detector, class, bucket) — never on arrival order or on
 *     when the bucket was queried — so re-processing the same detection or
 *     receiving detections out of order always yields the same event id
 *     (idempotent) and never creates duplicate events.
 *   - Only detections on the same camera, from the same detector, of the
 *     same class are ever grouped. Different cameras, detectors and classes
 *     never merge.
 *
 * Correlation never redefines severity: an event's severities remain exactly
 * what the existing confidence/configured-threshold derivation defines them
 * to be. Correlation is contextual and informational only.
 *
 * No schema change is required: the existing `Detection.metadata` JSON column
 * carries the correlation summary, and the existing alert message carries an
 * explainable reference to the correlated event.
 */

import { createHash } from "node:crypto";
import { prisma } from "../config/prisma";
import type { Prisma } from "@prisma/client";

export type CorrelationSource = "engine" | "api";

/** Fall back to the engine's default alert cooldown (see runtimeRegistry). */
export const CORRELATION_DEFAULT_WINDOW_MS = 30_000;

/** An event is "correlated" once at least two detections share its bucket. */
export const CORRELATION_MIN_GROUP_SIZE = 2;

/** Minimal, deterministic signal used by the pure correlation engine. */
export interface DetectionSignal {
  id: string;
  cameraId: string;
  detectorKey: string | null;
  className: string | null;
  label: string;
  timestamp: Date;
  confidence: number;
  trackId: string | null;
}

/** What is stored inside `Detection.metadata.correlation` and returned to UI. */
export interface EventCorrelationSummary {
  eventId: string;
  correlated: boolean;
  groupKey: string;
  count: number;
  relatedDetectionIds: string[];
  trackIds: string[];
  labels: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  maxConfidence: number;
  avgConfidence: number;
  windowMs: number;
  source: CorrelationSource;
  reason: string;
}

/**
 * Start of the fixed, epoch-aligned window that contains `timestampMs`.
 * Alignment (rather than anchoring at the first detection seen) is what keeps
 * event ids independent of arrival order and reprocessing.
 */
export function eventBucketStart(timestampMs: number, windowMs: number): number {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Correlation window must be a positive number of milliseconds");
  }
  return Math.floor(timestampMs / windowMs) * windowMs;
}

/** Grouping identity: only these three dimensions may ever share an event. */
export function correlationGroupKey(
  cameraId: string,
  detectorKey: string | null,
  className: string | null,
): string {
  return `${cameraId}|${detectorKey ?? ""}|${className ?? ""}`;
}

/** Short, stable, deterministic event id derived from group + bucket. */
export function eventIdFor(groupKey: string, bucketStartMs: number): string {
  const digest = createHash("sha1").update(`${groupKey}:${bucketStartMs}`).digest("hex");
  return `evt-${digest.slice(0, 12)}`;
}

/**
 * Pure aggregation over the detections that share one event. Order is sorted
 * by timestamp so `firstSeenAt`/`lastSeenAt` are exact; confidence values are
 * copied (never fabricated); `count` counts real rows.
 */
export function summarizeCorrelation(
  signals: DetectionSignal[],
  windowMs: number,
  source: CorrelationSource,
): EventCorrelationSummary {
  if (signals.length === 0) {
    throw new Error("Cannot correlate an empty detection set");
  }

  const ordered = [...signals].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const reference = ordered[0];
  const groupKey = correlationGroupKey(reference.cameraId, reference.detectorKey, reference.className);
  const bucketStartMs = eventBucketStart(reference.timestamp.getTime(), windowMs);

  const confidences = ordered.map((d) => d.confidence);
  const trackIds = [...new Set(ordered.map((d) => d.trackId).filter((t): t is string => t !== null))];
  const labels = [
    ...new Set(
      ordered
        .map((d) => d.label || d.className || "")
        .filter((s) => s.length > 0),
    ),
  ];
  const correlated = ordered.length >= CORRELATION_MIN_GROUP_SIZE;

  return {
    eventId: eventIdFor(groupKey, bucketStartMs),
    correlated,
    groupKey,
    count: ordered.length,
    relatedDetectionIds: ordered.filter((d) => d.id !== reference.id).map((d) => d.id),
    trackIds,
    labels,
    firstSeenAt: ordered[0].timestamp.toISOString(),
    lastSeenAt: ordered[ordered.length - 1].timestamp.toISOString(),
    maxConfidence: Math.max(...confidences),
    avgConfidence: confidences.reduce((a, b) => a + b, 0) / confidences.length,
    windowMs,
    source,
    reason: correlated
      ? `${ordered.length} related detections grouped on camera ${reference.cameraId} within a ${Math.round(windowMs / 1000)}s window.`
      : `Single detection — no related detections within the ${Math.round(windowMs / 1000)}s correlation window.`,
  };
}

/** Explainable suffix appended to alert messages when an event is correlated. */
export function correlationMessageSuffix(summary: EventCorrelationSummary | null | undefined): string {
  if (!summary || !summary.correlated) return "";
  return ` Correlated with ${summary.count} detections (${summary.labels.join(", ") || "same class"}, event ${summary.eventId}).`;
}

interface CorrelatableDetection {
  id: string;
  cameraId: string;
  detectorKey?: string | null;
  className?: string | null;
  label?: string;
  timestamp: Date;
  confidence: number;
  trackId?: string | null;
}

export const correlationService = {
  /**
   * Resolve the correlation window from an existing detector setting. No
   * detector (or no setting row) falls back to the engine's default alert
   * cooldown — the same value used everywhere else as the alert window.
   */
  async resolveWindowMs(detectorKey?: string | null): Promise<number> {
    if (!detectorKey) return CORRELATION_DEFAULT_WINDOW_MS;
    const model = await prisma.aIModel.findUnique({
      where: { detectorKey },
      select: { settings: { select: { alertCooldownMs: true } } },
    });
    return model?.settings?.alertCooldownMs ?? CORRELATION_DEFAULT_WINDOW_MS;
  },

  /** Detections in the same fixed bucket as the (camera, detector, class). */
  async findBucketSignals(
    cameraId: string,
    detectorKey: string | null,
    className: string | null,
    bucketStartMs: number,
    windowMs: number,
  ): Promise<DetectionSignal[]> {
    const where: Prisma.DetectionWhereInput = {
      cameraId,
      timestamp: { gte: new Date(bucketStartMs), lt: new Date(bucketStartMs + windowMs) },
    };
    if (detectorKey) where.detectorKey = detectorKey;
    if (className) where.className = className;

    const rows = await prisma.detection.findMany({
      where,
      select: {
        id: true,
        cameraId: true,
        detectorKey: true,
        className: true,
        label: true,
        confidence: true,
        trackId: true,
        timestamp: true,
      },
      orderBy: { timestamp: "asc" },
    });

    return rows.map((row) => ({
      id: row.id,
      cameraId: row.cameraId,
      detectorKey: row.detectorKey,
      className: row.className,
      label: row.label,
      confidence: row.confidence,
      trackId: row.trackId,
      timestamp: row.timestamp,
    }));
  },

  /**
   * Persist the correlation summary onto a detection's existing metadata,
   * preserving every current key. Idempotent: calling twice produces the
   * same shape. No-op for uncorrelated (single) detections — their metadata
   * is not touched at all.
   */
  async annotateDetection(detectionId: string, summary: EventCorrelationSummary): Promise<void> {
    if (!summary.correlated) return;
    const row = await prisma.detection.findUnique({
      where: { id: detectionId },
      select: { metadata: true },
    });
    if (!row) return;

    const metadata: Record<string, unknown> =
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? { ...(row.metadata as Record<string, unknown>) }
        : {};
    metadata.correlation = summary;

    await prisma.detection.update({
      where: { id: detectionId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
  },

  /**
   * Persist the same correlation summary onto many detections in one read
   * plus a single transaction of writes (instead of a findUnique + update per
   * member). Each row keeps its existing metadata keys — only the
   * `correlation` key is overwritten, matching `annotateDetection`.
   */
  async annotateMembers(detectionIds: string[], summary: EventCorrelationSummary): Promise<void> {
    if (!summary.correlated || detectionIds.length === 0) return;
    const rows = await prisma.detection.findMany({
      where: { id: { in: detectionIds } },
      select: { id: true, metadata: true },
    });
    if (rows.length === 0) return;

    await prisma.$transaction(
      rows.map((row) => {
        const metadata: Record<string, unknown> =
          row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
            ? { ...(row.metadata as Record<string, unknown>) }
            : {};
        metadata.correlation = summary;
        return prisma.detection.update({
          where: { id: row.id },
          data: { metadata: metadata as Prisma.InputJsonValue },
        });
      }),
    );
  },

  /**
   * Correlate a batch of detections persisted by one engine frame. One bucket
   * query per (camera, detector, class) group in the frame; when the bucket
   * holds at least two detections, the current frame's rows are annotated and
   * every row (whether correlated or not) receives a summary keyed by id so
   * the alert stage can describe the event without a second query.
   *
   * Only the current frame's rows are ever updated — backfilling every prior
   * member on each new frame would be quadratic. Prior members share the same
   * deterministic event id, so event identity stays stable.
   */
  async annotateFrame(
    detections: CorrelatableDetection[],
    windowMs: number,
  ): Promise<Map<string, EventCorrelationSummary>> {
    const result = new Map<string, EventCorrelationSummary>();
    if (detections.length === 0) return result;

    const groups = new Map<string, CorrelatableDetection[]>();
    for (const d of detections) {
      const key = correlationGroupKey(d.cameraId, d.detectorKey ?? null, d.className ?? null);
      const members = groups.get(key) ?? [];
      members.push(d);
      groups.set(key, members);
    }

    for (const members of groups.values()) {
      const ref = members[0]!;
      const detectorKey = ref.detectorKey ?? null;
      const className = ref.className ?? null;
      const bucketStartMs = eventBucketStart(ref.timestamp.getTime(), windowMs);

      // Runs after `createMany` committed, so the bucket already includes the
      // current frame's rows — no double counting, no id guesswork.
      const signals = await this.findBucketSignals(
        ref.cameraId,
        detectorKey,
        className,
        bucketStartMs,
        windowMs,
      );
      if (signals.length === 0) continue;

      const summary = summarizeCorrelation(signals, windowMs, "engine");
      if (summary.correlated) {
        await this.annotateMembers(members.map((m) => m.id), summary);
      }
      for (const m of members) result.set(m.id, summary);
    }

    return result;
  },

  /**
   * Correlate a single detection created outside the engine pipeline (the
   * internal machine-to-machine ingestion). Conservative: without both a
   * detector key and a class signal there is nothing to group by, so the
   * detection is left untouched. When grouped, the summary is written to the
   * detection's metadata and returned for alert-message enrichment.
   */
  async correlateSingle(
    detection: CorrelatableDetection,
    explicitWindowMs?: number,
  ): Promise<EventCorrelationSummary | null> {
    const detectorKey = detection.detectorKey ?? null;
    const label = detection.label?.trim() ? detection.label! : null;
    const className = detection.className ?? label;
    if (!detectorKey || !className) return null;

    const windowMs = explicitWindowMs ?? (await this.resolveWindowMs(detectorKey));
    const bucketStartMs = eventBucketStart(detection.timestamp.getTime(), windowMs);
    const signals = await this.findBucketSignals(
      detection.cameraId,
      detectorKey,
      className,
      bucketStartMs,
      windowMs,
    );

    // The fresh detection committed before this call, so the bucket query
    // already contains it; guard the empty case for safety anyway.
    if (signals.length === 0) {
      const summary = summarizeCorrelation([signalFrom(detection)], windowMs, "api");
      return summary;
    }

    const summary = summarizeCorrelation(signals, windowMs, "api");
    if (summary.correlated) {
      await this.annotateDetection(detection.id, summary);
    }
    return summary;
  },
};

function signalFrom(detection: CorrelatableDetection): DetectionSignal {
  return {
    id: detection.id,
    cameraId: detection.cameraId,
    detectorKey: detection.detectorKey ?? null,
    className: detection.className ?? null,
    label: detection.label ?? detection.className ?? "",
    timestamp: detection.timestamp,
    confidence: detection.confidence,
    trackId: detection.trackId ?? null,
  };
}