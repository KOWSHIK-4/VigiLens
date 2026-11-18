/**
 * Analytics raw-SQL scoping — the tenant predicate must not depend on a date
 * filter being present. The optional `period`/`from`/`to` query parameters let
 * a caller request an all-time, org-scoped aggregate, which is exactly where a
 * dangling `AND` used to produce invalid SQL.
 */

import { describe, expect, it } from "vitest";
import { dateAndOrgWhereSql } from "../src/services/analytics.service";

const start = new Date("2026-09-01T00:00:00.000Z");

describe("dateAndOrgWhereSql", () => {
  it("scopes to the organization when no date filter is supplied", () => {
    const clause = dateAndOrgWhereSql(undefined, "org-1");

    expect(clause.text).toBe("WHERE organization_id = $1");
    expect(clause.values).toEqual(["org-1"]);
  });

  it("scopes to the organization when the date filter resolves to no bounds", () => {
    const clause = dateAndOrgWhereSql({}, "org-1");

    expect(clause.text).toBe("WHERE organization_id = $1");
    expect(clause.text.startsWith("WHERE")).toBe(true);
    expect(clause.text).not.toMatch(/^\s*AND\b/);
  });

  it("keeps team scoping alongside organization scoping", () => {
    const clause = dateAndOrgWhereSql(undefined, "org-1", "team-1");

    expect(clause.text).toBe("WHERE organization_id = $1 AND team_id = $2");
    expect(clause.values).toEqual(["org-1", "team-1"]);
  });

  it("prefixes a date range with WHERE before adding tenant conditions", () => {
    const clause = dateAndOrgWhereSql({ gte: start }, "org-1");

    expect(clause.text).toBe("WHERE timestamp >= $1 AND organization_id = $2");
    expect(clause.values).toEqual([start, "org-1"]);
  });

  it("returns no clause when nothing narrows the query", () => {
    expect(dateAndOrgWhereSql(undefined).text).toBe("");
  });
});
