import type { PipelineMetrics } from "./types";

export interface FrameSample {
  at: number;
  durationMs: number;
  detections: number;
}

export interface RollingMetricsSnapshot {
  windowSeconds: number;
  samples: number;
  averageProcessingTimeMs: number;
  maxProcessingTimeMs: number;
  detectionsInWindow: number;
  firstSampleAt: string | null;
  lastSampleAt: string | null;
}

/** Length of the rolling performance window. */
export const ROLLING_WINDOW_MS = 5 * 60 * 1000;
/** Maximum per-key frame samples retained inside the window. */
export const MAX_ROLLING_SAMPLES = 10_000;
/** Maximum distinct detector keys tracked; oldest-active is evicted past this. */
export const MAX_METRIC_KEYS = 512;

interface StoredEntry {
  metrics: PipelineMetrics;
  frames: FrameSample[];
}

export interface EngineMetricsStoreOptions {
  windowMs?: number;
  maxSamples?: number;
  maxKeys?: number;
  now?: () => number;
}

/**
 * Bounded in-memory store for engine pipeline metrics.
 *
 * Cumulative counters (frames processed/skipped, errors) are kept per key,
 * while per-frame latency/detection samples roll through a fixed window so a
 * long-running process reports recent performance instead of all-time
 * sums. The key set itself is capped: past `maxKeys`, the least-recently
 * active key is evicted so detector/key churn cannot grow the heap.
 */
export class EngineMetricsStore {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly windowMs: number;
  private readonly maxSamples: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: EngineMetricsStoreOptions = {}) {
    this.windowMs = options.windowMs ?? ROLLING_WINDOW_MS;
    this.maxSamples = options.maxSamples ?? MAX_ROLLING_SAMPLES;
    this.maxKeys = options.maxKeys ?? MAX_METRIC_KEYS;
    this.now = options.now ?? Date.now;
  }

  get(key: string): PipelineMetrics | null {
    return this.entries.get(key)?.metrics ?? null;
  }

  getRolling(key: string): RollingMetricsSnapshot | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.trimFrames(entry.frames, this.now());
    if (entry.frames.length === 0) return null;

    const durations = entry.frames.map((sample) => sample.durationMs);
    const totalMs = durations.reduce((sum, duration) => sum + duration, 0);
    const detections = entry.frames.reduce((sum, sample) => sum + sample.detections, 0);

    return {
      windowSeconds: Math.round(this.windowMs / 1000),
      samples: entry.frames.length,
      averageProcessingTimeMs: Math.round((totalMs / entry.frames.length) * 100) / 100,
      maxProcessingTimeMs: Math.round(Math.max(...durations) * 100) / 100,
      detectionsInWindow: detections,
      firstSampleAt: new Date(entry.frames[0].at).toISOString(),
      lastSampleAt: new Date(entry.frames[entry.frames.length - 1].at).toISOString(),
    };
  }

  /** Merges a pipeline result into the cumulative counters and rolls a frame sample. */
  record(key: string, incoming: PipelineMetrics, durationMs: number, detections: number): void {
    const at = this.now();
    const existing = this.entries.get(key);

    if (!existing) {
      this.evictIfNeeded();
      this.entries.set(key, {
        metrics: { ...incoming },
        frames: [{ at, durationMs, detections }],
      });
      return;
    }

    const metrics = existing.metrics;
    metrics.framesProcessed = metrics.framesProcessed + incoming.framesProcessed;
    metrics.framesSkipped = metrics.framesSkipped + incoming.framesSkipped;
    metrics.inferenceTimeMs = incoming.inferenceTimeMs;
    metrics.preprocessingTimeMs = incoming.preprocessingTimeMs;
    metrics.postprocessingTimeMs = incoming.postprocessingTimeMs;
    metrics.trackingTimeMs = incoming.trackingTimeMs;
    metrics.totalProcessingTimeMs = incoming.totalProcessingTimeMs;
    metrics.detectionsPerFrame = incoming.detectionsPerFrame;
    metrics.lastDetectionAt = incoming.lastDetectionAt;
    metrics.lastFrameAt = incoming.lastFrameAt;
    metrics.lastSuccessfulInferenceAt = incoming.lastSuccessfulInferenceAt;
    metrics.lastError = incoming.lastError;
    metrics.lastErrorAt = incoming.lastErrorAt;
    metrics.errorCount = metrics.errorCount + incoming.errorCount;
    existing.frames.push({ at, durationMs, detections });
    this.trimFrames(existing.frames, at);
  }

  /** Merges a failure into the cumulative counters (no rolling frame sample). */
  recordError(key: string, message: string): void {
    const existing = this.entries.get(key);
    const at = this.now();

    if (existing) {
      existing.metrics.errorCount += 1;
      existing.metrics.framesSkipped += 1;
      existing.metrics.lastError = message;
      existing.metrics.lastErrorAt = new Date(at);
      return;
    }

    this.evictIfNeeded();
    this.entries.set(key, {
      metrics: {
        framesProcessed: 0,
        framesSkipped: 1,
        inferenceTimeMs: 0,
        preprocessingTimeMs: 0,
        postprocessingTimeMs: 0,
        trackingTimeMs: 0,
        totalProcessingTimeMs: 0,
        detectionsPerFrame: 0,
        lastDetectionAt: null,
        lastFrameAt: new Date(at),
        lastSuccessfulInferenceAt: null,
        lastError: message,
        lastErrorAt: new Date(at),
        errorCount: 1,
      },
      frames: [],
    });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get activeKeys(): number {
    return this.entries.size;
  }

  private evictIfNeeded(): void {
    if (this.entries.size < this.maxKeys) return;
    let oldestKey: string | null = null;
    let oldestAt = Infinity;
    for (const [key, entry] of this.entries) {
      const lastFrameAt =
        entry.frames.length > 0 ? entry.frames[entry.frames.length - 1].at : 0;
      if (lastFrameAt < oldestAt) {
        oldestAt = lastFrameAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) this.entries.delete(oldestKey);
  }

  private trimFrames(frames: FrameSample[], at: number): void {
    const cutoff = at - this.windowMs;
    let firstAlive = 0;
    while (firstAlive < frames.length && frames[firstAlive].at < cutoff) {
      firstAlive += 1;
    }
    if (firstAlive > 0) frames.splice(0, firstAlive);
    if (frames.length > this.maxSamples) {
      frames.splice(0, frames.length - this.maxSamples);
    }
  }
}