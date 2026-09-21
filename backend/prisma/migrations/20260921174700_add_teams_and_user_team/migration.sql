-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditLogAction" ADD VALUE 'team_created';
ALTER TYPE "AuditLogAction" ADD VALUE 'team_updated';
ALTER TYPE "AuditLogAction" ADD VALUE 'team_deleted';
ALTER TYPE "AuditLogAction" ADD VALUE 'team_member_assigned';
ALTER TYPE "AuditLogAction" ADD VALUE 'team_member_removed';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "team_id" TEXT;

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "teams_organization_id_idx" ON "teams"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_organization_id_name_key" ON "teams"("organization_id", "name");

-- CreateIndex
CREATE INDEX "users_team_id_idx" ON "users"("team_id");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Teams permission catalog: newly introduced teams.* permissions must also be
-- granted to the built-in roles here so existing tenants get them without a
-- destructive re-seed. Deterministic UUIDs keep the rows stable across fresh
-- installs and re-seeds (seed.ts upserts by key and keeps these ids).
INSERT INTO "permissions" ("id", "key", "name", "description", "category")
VALUES
  ('20000000-0000-0000-0000-000000000001', 'teams.read', 'View Teams', 'View teams and their members', 'teams'),
  ('20000000-0000-0000-0000-000000000002', 'teams.manage', 'Manage Teams', 'Create, edit and delete teams and manage memberships', 'teams')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_name", "permission_id")
SELECT rp.role_name, rp.permission_id
FROM (VALUES
  ('super_admin', '20000000-0000-0000-0000-000000000001'),
  ('super_admin', '20000000-0000-0000-0000-000000000002'),
  ('admin',       '20000000-0000-0000-0000-000000000001'),
  ('admin',       '20000000-0000-0000-0000-000000000002'),
  ('operator',    '20000000-0000-0000-0000-000000000001'),
  ('viewer',      '20000000-0000-0000-0000-000000000001')
) AS rp(role_name, permission_id)
WHERE rp.role_name IN (SELECT "name" FROM "roles")
  AND EXISTS (SELECT 1 FROM "permissions" p WHERE p."id" = rp.permission_id)
ON CONFLICT DO NOTHING;
