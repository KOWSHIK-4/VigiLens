import { describe, it, expect } from "vitest";
import { rangeKeyFor } from "../src/services/analytics.service";
import { updateCameraSchema } from "../src/types";

describe("analytics cache range keys", () => {
  it("period-based params produce a stable key", () => {
    expect(rangeKeyFor({ period: "7" })).toBe("p7");
    expect(rangeKeyFor({ period: "30" })).toBe("p30");
  });

  it("explicit from/to form the key instead of being ignored", () => {
    const a = rangeKeyFor({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-22T23:59:59.000Z",
    });
    const b = rangeKeyFor({
      from: "2026-08-02T00:00:00.000Z",
      to: "2026-08-22T23:59:59.000Z",
    });
    expect(a).not.toBe(b);
    expect(a).toContain("2026-08-01");
  });

  it("partial ranges still differ from each other", () => {
    const onlyFrom = rangeKeyFor({ from: "2026-08-01T00:00:00.000Z" });
    const none = rangeKeyFor({});
    expect(onlyFrom).not.toBe(none);
  });
});

describe("updateCameraSchema", () => {
  it("rejects an empty patch", () => {
    const result = updateCameraSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts a single-field patch", () => {
    const result = updateCameraSchema.safeParse({ name: "Front Door" });
    expect(result.success).toBe(true);
  });
});
