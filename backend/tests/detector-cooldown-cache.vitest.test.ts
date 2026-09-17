import { describe, it, expect, vi } from "vitest";
import { createDetectorCooldownCache } from "../src/utils/detectorCooldownCache";

describe("detectorCooldownCache", () => {
  it("loads the cooldown once and serves subsequent hits from cache", async () => {
    const load = vi.fn(async () => 60_000);
    const cache = createDetectorCooldownCache({ ttlMs: 10_000, loadCooldownMs: load });

    await expect(cache.resolve("person", 30_000)).resolves.toBe(60_000);
    await expect(cache.resolve("person", 30_000)).resolves.toBe(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
  });

  it("falls back to the default when the detector has no configured value", async () => {
    const load = vi.fn(async () => null);
    const cache = createDetectorCooldownCache({ loadCooldownMs: load });

    await expect(cache.resolve("vehicles", 20_000)).resolves.toBe(20_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("returns the default without a loader call for missing detector keys", async () => {
    const load = vi.fn(async () => 60_000);
    const cache = createDetectorCooldownCache({ loadCooldownMs: load });

    await expect(cache.resolve(undefined, 15_000)).resolves.toBe(15_000);
    await expect(cache.resolve(null, 15_000)).resolves.toBe(15_000);
    expect(load).not.toHaveBeenCalled();
  });

  it("reloads after the TTL lapses", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 60_000);
    const cache = createDetectorCooldownCache({ ttlMs: 1_000, loadCooldownMs: load });

    await cache.resolve("person", 30_000);
    vi.advanceTimersByTime(1_001);
    await cache.resolve("person", 30_000);
    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("invalidate() drops a single entry or the whole cache", async () => {
    const load = vi.fn(async () => 60_000);
    const cache = createDetectorCooldownCache({ loadCooldownMs: load });

    await cache.resolve("person", 30_000);
    await cache.resolve("vehicle", 30_000);
    expect(cache.size).toBe(2);

    cache.invalidate("person");
    expect(cache.size).toBe(1);

    await cache.resolve("person", 30_000);
    expect(cache.size).toBe(2);

    cache.invalidate();
    expect(cache.size).toBe(0);
  });

  it("keeps working on a loader failure by falling back to the default", async () => {
    const load = vi.fn(async () => {
      throw new Error("db down");
    });
    const cache = createDetectorCooldownCache({ loadCooldownMs: load });

    await expect(cache.resolve("person", 25_000)).resolves.toBe(25_000);
  });
});