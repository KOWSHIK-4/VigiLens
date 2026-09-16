import { createHash } from "node:crypto";

/**
 * Tamper-evidence stamping for audit log rows.
 *
 * Each row is SHA-256 hashed over its immutable id plus the audit fields
 * (action, module, description, actor, metadata, ...). The stamp covers only
 * the values that are written once at insert time, never the timestamp, so a
 * row that is later edited in place no longer matches its stored hash. The
 * hash is not keyed: an attacker who can fully recompute it could forge it,
 * but any partial or in-place edit (the common case) is caught, which makes
 * the chain tamper-evident rather than tamper-proof.
 */

export interface AuditChainRow {
  id: string;
  userId: string | null;
  username: string;
  email: string;
  action: string;
  module: string;
  description: string;
  ipAddress: string;
  userAgent: string;
  status: string;
  metadata?: unknown;
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  return String(value);
}

export function canonicalAuditRow(row: AuditChainRow): string {
  return [
    row.id,
    row.userId ?? "",
    row.username,
    row.email,
    row.action,
    row.module,
    row.description,
    row.ipAddress,
    row.userAgent,
    row.status,
    canonicalize(row.metadata ?? {}),
  ].join("|");
}

export function computeAuditHash(row: AuditChainRow): string {
  return createHash("sha256").update(canonicalAuditRow(row)).digest("hex");
}

export function auditRowMatchesHash(row: AuditChainRow, hash: string | null | undefined): boolean {
  return !!hash && computeAuditHash(row) === hash;
}