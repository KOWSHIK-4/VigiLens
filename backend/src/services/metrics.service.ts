import { appVersion } from "../config/version";

interface RequestSample {
  timestamp: number;
  durationMs: number;
  statusCode: number;
  endpoint: string;
}

interface DetectionSample {
  timestamp: number;
  durationMs: number;
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_SAMPLES = 50_000;
const SLOW_REQUEST_THRESHOLD_MS = 1000;
const TOP_ENDPOINTS = 10;
const MAX_OPERATION_KEYS = 200;

let requestSamples: RequestSample[] = [];
let detectionSamples: DetectionSample[] = [];
const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const startedAt = Date.now();

function prune<T extends { timestamp: number }>(samples: T[]): T[] {
  const cutoff = Date.now() - WINDOW_MS;
  let firstAlive = 0;
  while (firstAlive < samples.length && samples[firstAlive].timestamp < cutoff) {
    firstAlive += 1;
  }
  if (firstAlive === 0) return samples;
  return samples.slice(firstAlive);
}

function record<T extends { timestamp: number }>(
  samples: T[],
  sample: T,
): T[] {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples = samples.slice(samples.length - MAX_SAMPLES);
  }
  return samples;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

function trimOperationMap(map: Map<string, number>): void {
  if (map.size <= MAX_OPERATION_KEYS) return;
  // Drop the oldest keys (Map preserves insertion order) until under the bound.
  while (map.size > MAX_OPERATION_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export const metricsService = {
  recordRequest(durationMs: number, statusCode: number, endpoint?: string) {
    requestSamples = record(requestSamples, {
      timestamp: Date.now(),
      durationMs,
      statusCode,
      endpoint: endpoint ?? "",
    });
    requestSamples = prune(requestSamples);
  },

  recordDetection(durationMs: number) {
    detectionSamples = record(detectionSamples, {
      timestamp: Date.now(),
      durationMs,
    });
    detectionSamples = prune(detectionSamples);
  },

  /**
   * Count an operational event (alerts created, webhooks dispatched, SSE
   * publishes, model runs, ...). Counters survive the sample window and only
   * reset on process restart, which makes long-ish trends visible.
   */
  recordEvent(name: string, delta = 1) {
    const next = (counters.get(name) ?? 0) + delta;
    counters.set(name, next);
    trimOperationMap(counters);
  },

  /** Current-value gauge, e.g. the number of live SSE subscribers. */
  setGauge(name: string, value: number) {
    gauges.set(name, value);
    trimOperationMap(gauges);
  },

  /** Test hook: clears all recorded samples and counters. */
  reset() {
    requestSamples = [];
    detectionSamples = [];
    counters.clear();
    gauges.clear();
  },

  getSnapshot() {
    requestSamples = prune(requestSamples);
    detectionSamples = prune(detectionSamples);

    const durations = requestSamples.map((sample) => sample.durationMs);
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const errorCount = requestSamples.filter((sample) => sample.statusCode >= 400).length;
    const slowRequestCount = requestSamples.filter(
      (sample) => sample.durationMs >= SLOW_REQUEST_THRESHOLD_MS,
    ).length;

    const average =
      durations.length > 0
        ? durations.reduce((sum, duration) => sum + duration, 0) / durations.length
        : 0;

    const detectionDurations = detectionSamples.map((sample) => sample.durationMs);
    const averageDetection =
      detectionDurations.length > 0
        ? detectionDurations.reduce((sum, duration) => sum + duration, 0) /
          detectionDurations.length
        : 0;

    const statusCodes: Record<string, number> = {};
    const endpointCounts = new Map<string, number>();
    for (const sample of requestSamples) {
      statusCodes[String(sample.statusCode)] = (statusCodes[String(sample.statusCode)] ?? 0) + 1;
      if (sample.endpoint) {
        endpointCounts.set(sample.endpoint, (endpointCounts.get(sample.endpoint) ?? 0) + 1);
      }
    }

    const topEndpoints = Array.from(endpointCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_ENDPOINTS)
      .map(([endpoint, count]) => ({ endpoint, count }));

    return {
      version: appVersion,
      windowSeconds: Math.round(WINDOW_MS / 1000),
      slowRequestThresholdMs: SLOW_REQUEST_THRESHOLD_MS,
      collectedAt: new Date().toISOString(),
      requests: {
        total: requestSamples.length,
        errorCount,
        errorRate: requestSamples.length > 0 ? errorCount / requestSamples.length : 0,
        averageResponseTimeMs: Math.round(average * 100) / 100,
        p95ResponseTimeMs: Math.round(percentile(sortedDurations, 0.95) * 100) / 100,
        maxResponseTimeMs:
          sortedDurations.length > 0
            ? Math.round(sortedDurations[sortedDurations.length - 1] * 100) / 100
            : 0,
        slowRequestCount,
        statusCodes,
        topEndpoints,
      },
      detections: {
        total: detectionSamples.length,
        averageProcessingTimeMs: Math.round(averageDetection * 100) / 100,
      },
      operations: {
        counters: Object.fromEntries(counters),
        gauges: Object.fromEntries(gauges),
      },
      uptime: {
        processSeconds: Math.round(process.uptime()),
        sinceStartedSeconds: Math.round((Date.now() - startedAt) / 1000),
      },
    };
  },
};