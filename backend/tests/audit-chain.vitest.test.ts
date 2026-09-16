import { describe, it, expect } from "vitest";
import {
  computeAuditHash,
  auditRowMatchesHash,
  type AuditChainRow,
} from "../src/utils/auditChain";

function sampleRow(overrides: Partial<AuditChainRow> = {}): AuditChainRow {
  return {
    id: "test-row-1",
    userId: "u-1",
    username: "alice",
    email: "alice@example.com",
    action: "user_login",
    module: "auth",
    description: "Logged in",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
    status: "success",
    metadata: { foo: "bar" },
    ...overrides,
  };
}

describe("audit chain", () => {
  it("produces a 64-character hex digest", () => {
    const hash = computeAuditHash(sampleRow());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const row = sampleRow();
    expect(computeAuditHash(row)).toBe(computeAuditHash(row));
  });

  it("detects a modified field", () => {
    const row = sampleRow();
    const original = computeAuditHash(row);
    const tampered = { ...row, description: "admin takeover" };
    expect(computeAuditHash(tampered)).not.toBe(original);
    expect(auditRowMatchesHash(tampered, original)).toBe(false);
  });

  it("passes verification with an unmodified row", () => {
    const row = sampleRow();
    expect(auditRowMatchesHash(row, computeAuditHash(row))).toBe(true);
  });

  it("treats null hash as not verified", () => {
    expect(auditRowMatchesHash(sampleRow(), null)).toBe(false);
  });

  it("is insensitive to metadata key ordering", () => {
    const a = sampleRow({ metadata: { b: 1, a: 2 } });
    const b = sampleRow({ metadata: { a: 2, b: 1 } });
    expect(computeAuditHash(a)).toBe(computeAuditHash(b));
  });

  it("produces different hashes for different ids", () => {
    const a = sampleRow({ id: "row-a" });
    const b = sampleRow({ id: "row-b" });
    expect(computeAuditHash(a)).not.toBe(computeAuditHash(b));
  });

  it("treats undefined metadata as empty", () => {
    const row = sampleRow({ metadata: undefined });
    expect(computeAuditHash(row)).toBe(computeAuditHash(sampleRow({ metadata: {} })));
  });
});
