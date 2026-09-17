/**
 * Short-lived cache for detector alert-cooldown settings.
 *
 * The alert engine and the correlation pipeline both resolve a detector's
 * `alertCooldownMs` before deciding whether to raise an alert or bucket
 * correlated detections. On continuous ingestion paths that would otherwise
 * cost one `aIModel` lookup per detection; this cache bounds it to one
 * lookup per detector per TTL. Settings edits invalidate the affected entry
 * so the cache can never serve a stale value after an operator change.
 *
 * The cache is intentionally best-effort: a DB failure on a miss falls back
 * to the caller's default without breaking the hot path, matching the
 * non-blocking behavior of the rest of the ingestion pipeline.
 */

import { prisma } from "../config/prisma";

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 200;

interface Entry {
  cooldownMs: number;
  expiresAt: number;
}

export interface DetectorCooldownCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  loadCooldownMs?: (detectorKey: string) => Promise<number | null>;
}

export function createDetectorCooldownCache(options: DetectorCooldownCacheOptions = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const cache = new Map<string, Entry>();
  const loadCooldownMs =
    options.loadCooldownMs ??
    (async (detectorKey: string) => {
      const model = await prisma.aIModel.findUnique({
        where: { detectorKey },
        select: { settings: { select: { alertCooldownMs: true } } },
      });
      return model?.settings?.alertCooldownMs ?? null;
    });

  function prune() {
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= Date.now()) cache.delete(key);
    }
    while (cache.size >= maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  return {
    /**
     * Resolve the alert cooldown for a detector, falling back to
     * `fallbackMs` when the detector has no configured value. The DB loader
     * runs only on a cache miss.
     */
    async resolve(
      detectorKey: string | undefined | null,
      fallbackMs: number,
    ): Promise<number> {
      if (!detectorKey) return fallbackMs;
      const hit = cache.get(detectorKey);
      if (hit && hit.expiresAt > Date.now()) return hit.cooldownMs;
      let cooldownMs = fallbackMs;
      try {
        cooldownMs = (await loadCooldownMs(detectorKey)) ?? fallbackMs;
      } catch {
        // Transient DB errors must never break the hot ingestion path.
      }
      prune();
      cache.set(detectorKey, { cooldownMs, expiresAt: Date.now() + ttlMs });
      return cooldownMs;
    },

    /** Drop one detector entry, or the whole cache when no key is given. */
    invalidate(detectorKey?: string) {
      if (detectorKey) {
        cache.delete(detectorKey);
      } else {
        cache.clear();
      }
    },

    get size() {
      return cache.size;
    },
  };
}

/** Shared instance used by the alert engine and correlation pipeline. */
export const detectorCooldownCache = createDetectorCooldownCache();