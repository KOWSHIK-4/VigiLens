/**
 * Detector Engine v2 — Object Tracking.
 *
 * A simple, deterministic, single-frame tracker based on IoU overlap
 * between the previous frame's tracks and the current detections. It is
 * deliberately lightweight (no external tracker dependency) while still
 * providing stable `trackId`s that the UI and persistence can rely on.
 */

import type { BoundingBox, RawDetection, TrackedDetection } from "./types";
import { iou } from "./geometry";

export interface TrackEntry {
  id: number;
  bbox: BoundingBox;
  className: string;
  hits: number;
  misses: number;
  lastSeenAt: number;
}

/**
 * TrackingStage implementations assign a stable identity to detections
 * that persist across frames. Swappable, but `IouTracker` is the default.
 */
export interface ObjectTracker {
  update(detections: RawDetection[], timestamp: number): TrackedDetection[];
  reset(): void;
}

export interface IouTrackerOptions {
  /** IoU threshold above which a detection matches an existing track. */
  matchIoU: number;
  /** Tracks dropped after this many frames without a match. */
  maxMisses: number;
  /** Detections must exceed this IoU with the tracker start to get a new id. */
  startNewTrackIoU: number;
}

const DEFAULT_OPTIONS: IouTrackerOptions = {
  matchIoU: 0.35,
  maxMisses: 30,
  startNewTrackIoU: 0.05,
};

/**
 * Greedy IoU tracker: each detection is matched to the active track with
 * the highest overlap above `matchIoU`. A track can be consumed by at most
 * one detection per frame — two heavily-overlapping detections can never
 * both claim the same identity. Matched tracks are updated and kept alive;
 * unmatched detections spawn new tracks; tracks that miss too many frames
 * are retired. Ids are monotonically increasing and never reused.
 */
export class IouTracker implements ObjectTracker {
  private readonly tracks = new Map<number, TrackEntry>();
  private readonly options: IouTrackerOptions;
  private nextId = 0;

  constructor(options: Partial<IouTrackerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  update(detections: RawDetection[], timestamp: number): TrackedDetection[] {
    // Ids of tracks seen on this frame — either matched to a detection or
    // freshly created. Retirement only ages tracks absent from this set,
    // so a brand-new track never starts its life with a miss.
    const seen = new Set<number>();
    // Tracks already claimed by an earlier detection this frame; excluded
    // from later matches so one identity cannot serve two detections.
    const consumed = new Set<number>();

    const result: TrackedDetection[] = detections.map((detection) => {
      let bestId: number | null = null;
      let bestIoU = this.options.matchIoU;

      for (const [id, track] of this.tracks) {
        if (consumed.has(id)) continue;
        if (track.className !== detection.className) continue;
        const overlap = iou(track.bbox, detection.bbox);
        if (overlap >= bestIoU) {
          bestIoU = overlap;
          bestId = id;
        }
      }

      const tracked = bestId !== null;
      const id = bestId ?? this.nextId++;
      seen.add(id);
      if (tracked) consumed.add(id);

      let entry = this.tracks.get(id);
      if (!entry) {
        entry = {
          id,
          bbox: detection.bbox,
          className: detection.className,
          hits: 0,
          misses: 0,
          lastSeenAt: timestamp,
        };
        this.tracks.set(id, entry);
      }
      entry.bbox = detection.bbox;
      entry.hits += 1;
      entry.lastSeenAt = timestamp;

      return {
        ...detection,
        trackId: String(id),
        objectId: `${detection.className}:${id}`,
      };
    });

    // Retirement: tracks not seen this frame age out after maxMisses.
    for (const [id, track] of this.tracks) {
      if (!seen.has(id)) {
        track.misses += 1;
        if (track.misses > this.options.maxMisses) {
          this.tracks.delete(id);
        }
      } else {
        track.misses = 0;
      }
    }

    return result;
  }

  reset(): void {
    this.tracks.clear();
    this.nextId = 0;
  }

  get activeTrackCount(): number {
    return this.tracks.size;
  }
}
