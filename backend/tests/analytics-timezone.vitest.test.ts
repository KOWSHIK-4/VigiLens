import { describe, it, expect } from "vitest";
import {
  startOfDayInTz,
  endOfDayInTz,
  validTimezone,
  rangeKeyFor,
} from "../src/services/analytics.service";
import { analyticsQuerySchema } from "../src/types";

describe("timezone helpers", () => {
  it("resolves the start of the local day in a positive-offset zone", () => {
    const instant = new Date(Date.UTC(2026, 5, 1, 12, 0, 0)); // UTC noon
    expect(startOfDayInTz(instant, "Asia/Kolkata").toISOString()).toBe("2026-05-31T18:30:00.000Z");
  });

  it("resolves the start of the local day in a negative-offset zone", () => {
    const instant = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    expect(startOfDayInTz(instant, "America/New_York").toISOString()).toBe("2026-06-01T04:00:00.000Z");
  });

  it("endOfDayInTz is one day minus one millisecond after start of day", () => {
    const instant = new Date(Date.UTC(2026, 5, 1, 12, 0, 0));
    expect(endOfDayInTz(instant, "Asia/Kolkata").toISOString()).toBe("2026-06-01T18:29:59.999Z");
  });

  it("handles an instant just after local midnight", () => {
    const justAfterMidnight = new Date("2026-05-31T18:30:00.001Z");
    expect(startOfDayInTz(justAfterMidnight, "Asia/Kolkata").toISOString()).toBe(
      "2026-05-31T18:30:00.000Z"
    );
  });

  it("validTimezone accepts IANA names and rejects garbage", () => {
    expect(validTimezone("Asia/Kolkata")).toBe(true);
    expect(validTimezone("UTC")).toBe(true);
    expect(validTimezone("Not/AZone")).toBe(false);
    expect(validTimezone("")).toBe(false);
    expect(validTimezone(undefined)).toBe(true);
  });
});

describe("tz-aware cache keys", () => {
  it("keeps the legacy key when no timezone is requested", () => {
    expect(rangeKeyFor({ period: "7" })).toBe("p7");
  });

  it("separates cache entries by timezone", () => {
    const plain = rangeKeyFor({ from: "2026-08-01T00:00:00.000Z" });
    const tz = rangeKeyFor({ from: "2026-08-01T00:00:00.000Z", tz: "Asia/Kolkata" });
    expect(tz).not.toBe(plain);
    expect(tz).toContain("Asia/Kolkata");
  });
});

describe("analyticsQuerySchema timezone validation", () => {
  it("accepts a valid IANA timezone", () => {
    expect(analyticsQuerySchema.safeParse({ tz: "Europe/London" }).success).toBe(true);
  });

  it("rejects an invalid timezone", () => {
    expect(analyticsQuerySchema.safeParse({ tz: "Mars/Olympus" }).success).toBe(false);
  });

  it("still accepts the legacy params", () => {
    expect(analyticsQuerySchema.safeParse({ period: "30" }).success).toBe(true);
    expect(analyticsQuerySchema.safeParse({}).success).toBe(true);
  });
});