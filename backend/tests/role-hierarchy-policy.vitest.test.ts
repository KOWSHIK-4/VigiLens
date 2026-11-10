import { describe, expect, it } from "vitest";
import {
  SYSTEM_ROLE_RANK,
  SUPER_ADMIN_ROLE,
  isSystemRole,
  roleRank,
} from "../src/services/roleHierarchy";

describe("built-in role hierarchy", () => {
  it("defines a strictly increasing privilege order", () => {
    expect(roleRank("viewer")).toBeLessThan(roleRank("operator"));
    expect(roleRank("operator")).toBeLessThan(roleRank("admin"));
    expect(roleRank("admin")).toBeLessThan(roleRank(SUPER_ADMIN_ROLE));
  });

  it("recognizes only the seeded system roles", () => {
    for (const role of Object.keys(SYSTEM_ROLE_RANK)) {
      expect(isSystemRole(role)).toBe(true);
    }
    expect(isSystemRole("custom_auditor")).toBe(false);
    expect(isSystemRole("")).toBe(false);
  });

  it("assigns unranked custom roles a neutral rank", () => {
    expect(roleRank("custom_auditor")).toBe(0);
    expect(roleRank("unknown")).toBe(0);
  });

  it("keeps the system role rank mapping stable", () => {
    expect(SYSTEM_ROLE_RANK).toEqual({
      viewer: 1,
      operator: 2,
      admin: 3,
      super_admin: 4,
    });
  });
});
