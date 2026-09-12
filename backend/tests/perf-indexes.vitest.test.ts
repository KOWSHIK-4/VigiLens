import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATION_DIR = "20260913000000_add_performance_indexes";

const migrationSql = readFileSync(
  path.join(process.cwd(), "prisma", "migrations", MIGRATION_DIR, "migration.sql"),
  "utf8",
);
const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");

function indexNamesFromMigration(sql: string): string[] {
  const names: string[] = [];
  const re = /CREATE INDEX "([^"]+)" ON "([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql)) !== null) {
    names.push(`${match[2]}.${match[1]}`);
  }
  return names;
}

describe("performance index migration", () => {
  it("is purely additive CREATE INDEX statements", () => {
    const offending: string[] = [];
    for (const line of migrationSql.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("--")) continue;
      if (trimmed.startsWith("CREATE INDEX") && trimmed.endsWith(";")) continue;
      offending.push(trimmed);
    }
    expect(offending).toEqual([]);
    expect(migrationSql).toMatch(/CREATE INDEX "alerts_is_read_created_at_idx"/);
    expect(migrationSql).not.toMatch(/DROP INDEX|DROP TABLE|ALTER TABLE|CREATE TABLE/);
  });

  it("declares one composite index per hot filter-plus-sort pair", () => {
    const names = indexNamesFromMigration(migrationSql);
    for (const expected of [
      "alerts.alerts_is_read_created_at_idx",
      "alerts.alerts_severity_created_at_idx",
      "detections.detections_status_timestamp_idx",
      "incidents.incidents_status_opened_at_idx",
      "incidents.incidents_priority_opened_at_idx",
      "incidents.incidents_assigned_to_user_id_opened_at_idx",
      "incident_notes.incident_notes_incident_id_created_at_idx",
      "incident_activity.incident_activity_incident_id_created_at_idx",
      "audit_logs.audit_logs_action_timestamp_idx",
      "audit_logs.audit_logs_user_id_timestamp_idx",
      "audit_logs.audit_logs_status_timestamp_idx",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("keeps the Prisma schema in sync with the migration", () => {
    for (const name of indexNamesFromMigration(migrationSql)) {
      const [table] = name.split(".");
      const indexName = name.slice(table.length + 1);
      const re = new RegExp(`@@index\\(\\[[^\\]]*\\], map: "${indexName}"`);
      expect(schema, `schema missing @map for ${indexName}`).toMatch(re);
    }
  });
});