import { describe, it, expect, beforeEach } from "vitest";
import { logger, getRecentLogs, clearLogBuffer } from "../src/config/logger";

describe("in-memory log ring buffer", () => {
  beforeEach(() => {
    clearLogBuffer();
  });

  it("captures logged entries newest-first", () => {
    logger.info("hello observability", { requestId: "req-1" });
    const logs = getRecentLogs();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].level).toBe("info");
    expect(logs[0].message).toBe("hello observability");
    expect(logs[0].meta.requestId).toBe("req-1");
  });

  it("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      logger.info(`entry ${i}`);
    }
    const logs = getRecentLogs(2);
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("entry 4");
    expect(logs[1].message).toBe("entry 3");
  });

  it("returns an empty list when nothing has been logged", () => {
    const logs = getRecentLogs(5);
    expect(logs).toEqual([]);
  });
});