import { describe, it, expect } from "vitest";
import { aggregateUnreadSeverityCounts } from "../src/services/alert.service";

describe("aggregateUnreadSeverityCounts", () => {
  it("starts from zero for every severity", () => {
    expect(aggregateUnreadSeverityCounts([])).toEqual({
      critical: 0,
      warning: 0,
      info: 0,
    });
  });

  it("maps grouped rows into the stable critical/warning/info shape", () => {
    const rows = [
      { severity: "critical" as const, _count: { severity: 4 } },
      { severity: "warning" as const, _count: { severity: 2 } },
      { severity: "info" as const, _count: { severity: 1 } },
    ];
    expect(aggregateUnreadSeverityCounts(rows)).toEqual({
      critical: 4,
      warning: 2,
      info: 1,
    });
  });

  it("leaves missing severities at zero", () => {
    const rows = [{ severity: "critical" as const, _count: { severity: 7 } }];
    expect(aggregateUnreadSeverityCounts(rows)).toEqual({
      critical: 7,
      warning: 0,
      info: 0,
    });
  });

  it("never returns negative or non-integer counts", () => {
    const rows = [
      { severity: "critical" as const, _count: { severity: 0 } },
      { severity: "warning" as const, _count: { severity: 0 } },
      { severity: "info" as const, _count: { severity: 0 } },
    ];
    const result = aggregateUnreadSeverityCounts(rows);
    expect(Object.values(result).every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
  });
});