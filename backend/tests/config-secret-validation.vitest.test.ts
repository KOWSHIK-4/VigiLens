import { describe, it, expect } from "vitest";
import {
  isInsecureSecretValue,
  hasWeakDatabasePassword,
  isProductionEnvironment,
} from "../src/config";

describe("production secret validation", () => {
  it("rejects absent and whitespace-only secrets", () => {
    expect(isInsecureSecretValue(undefined)).toBe(true);
    expect(isInsecureSecretValue("   ")).toBe(true);
  });
  it("rejects short and recognizable placeholder values", () => {
    expect(isInsecureSecretValue("short-secret")).toBe(true);
    expect(isInsecureSecretValue("change_me_in_production_" + "a".repeat(32))).toBe(true);
    expect(isInsecureSecretValue("your_secret_key_" + "a".repeat(32))).toBe(true);
  });
  it("accepts a sufficiently long non-placeholder secret", () => {
    expect(isInsecureSecretValue("a".repeat(48))).toBe(false);
  });
  it("trims surrounding whitespace before evaluating length and markers", () => {
    expect(isInsecureSecretValue("  " + "a".repeat(32) + "  ")).toBe(false);
  });
});

describe("production environment detection", () => {
  it("recognizes production regardless of case or surrounding whitespace", () => {
    expect(isProductionEnvironment("production")).toBe(true);
    expect(isProductionEnvironment("Production")).toBe(true);
    expect(isProductionEnvironment("  PRODUCTION  ")).toBe(true);
  });

  it("does not treat other or missing values as production", () => {
    expect(isProductionEnvironment(undefined)).toBe(false);
    expect(isProductionEnvironment("")).toBe(false);
    expect(isProductionEnvironment("development")).toBe(false);
    expect(isProductionEnvironment("production-like")).toBe(false);
  });
});

describe("weak database password detection", () => {
  it("reports a missing database URL", () => {
    expect(hasWeakDatabasePassword(undefined)).toContain("not set");
  });
  it("detects known weak passwords in a database URL", () => {
    expect(hasWeakDatabasePassword("postgresql://user:postgres@db.example:5432/app")).toContain("weak password");
    expect(hasWeakDatabasePassword("postgresql://user:vigilens_secret@db.example:5432/app")).toContain("weak password");
  });
  it("allows a non-default database password", () => {
    expect(hasWeakDatabasePassword("postgresql://user:unique-long-password@db.example:5432/app")).toBeNull();
  });
  it("does not flag a URL whose password merely contains a weak word", () => {
    expect(hasWeakDatabasePassword("postgresql://user:my-postgres-project-secret@db.example:5432/app")).toBeNull();
  });
});
