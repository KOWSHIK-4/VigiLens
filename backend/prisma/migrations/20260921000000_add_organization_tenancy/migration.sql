-- Organization tenancy: introduces the Organization aggregate root and attaches
-- every tenant-owned aggregate to one. Existing single-tenant data is assigned
-- to a deterministic default organization so the migration is fully reversible
-- and idempotent on both fresh and populated databases.

-- 1) Organizations table

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- 2) Deterministic default organization for the existing single-tenant data.

INSERT INTO "organizations" ("id", "name", "slug", "description", "created_at", "updated_at")
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default Organization',
    'default',
    '',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
);

-- 3) Add tenant columns (nullable first so existing rows can be backfilled).

ALTER TABLE "users" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "cameras" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "detections" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "alerts" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "incidents" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "reports" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "audit_logs" ADD COLUMN "organization_id" TEXT;

-- 4) Backfill from the deterministic default org.

UPDATE "users" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

UPDATE "cameras" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

UPDATE "detections" d SET "organization_id" = COALESCE(c."organization_id", '00000000-0000-0000-0000-000000000001')
FROM "cameras" c
WHERE d."camera_id" = c."id" AND d."organization_id" IS NULL;

UPDATE "detections" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

UPDATE "alerts" a SET "organization_id" = COALESCE(d."organization_id", '00000000-0000-0000-0000-000000000001')
FROM "detections" d
WHERE a."detection_id" = d."id" AND a."organization_id" IS NULL;

UPDATE "alerts" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

UPDATE "incidents" i SET "organization_id" = COALESCE(a."organization_id", '00000000-0000-0000-0000-000000000001')
FROM "alerts" a
WHERE i."alert_id" = a."id" AND i."organization_id" IS NULL;

UPDATE "incidents" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

UPDATE "reports" r SET "organization_id" = COALESCE(u."organization_id", '00000000-0000-0000-0000-000000000001')
FROM "users" u
WHERE r."generated_by" = u."email" AND r."organization_id" IS NULL;

UPDATE "reports" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

UPDATE "audit_logs" al SET "organization_id" = u."organization_id"
FROM "users" u
WHERE al."user_id" = u."id" AND al."organization_id" IS NULL;

UPDATE "audit_logs" al SET "organization_id" = u."organization_id"
FROM "users" u
WHERE al."organization_id" IS NULL AND al."email" <> '' AND al."email" = u."email";

UPDATE "audit_logs" SET "organization_id" = '00000000-0000-0000-0000-000000000001'
WHERE "organization_id" IS NULL;

-- 5) Enforce NOT NULL on the tenant-owned aggregates (audit_logs stays nullable:
--    system-level and pre-tenancy rows keep a stable audit trail even if the
--    governing organization is ever removed).

ALTER TABLE "users" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "cameras" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "detections" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "alerts" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "incidents" ALTER COLUMN "organization_id" SET NOT NULL;
ALTER TABLE "reports" ALTER COLUMN "organization_id" SET NOT NULL;

-- 6) Foreign keys (cascading for tenant data; set-null for audit trail).

ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "detections" ADD CONSTRAINT "detections_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7) Tenant query indexes.

CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
CREATE INDEX "cameras_organization_id_idx" ON "cameras"("organization_id");
CREATE INDEX "detections_organization_id_idx" ON "detections"("organization_id");
CREATE INDEX "alerts_organization_id_idx" ON "alerts"("organization_id");
CREATE INDEX "incidents_organization_id_idx" ON "incidents"("organization_id");
CREATE INDEX "reports_organization_id_idx" ON "reports"("organization_id");
CREATE INDEX "audit_logs_organization_id_idx" ON "audit_logs"("organization_id");