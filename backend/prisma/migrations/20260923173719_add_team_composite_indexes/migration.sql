-- DropIndex
DROP INDEX "alerts_organization_id_idx";

-- DropIndex
DROP INDEX "alerts_team_id_idx";

-- DropIndex
DROP INDEX "cameras_organization_id_idx";

-- DropIndex
DROP INDEX "cameras_team_id_idx";

-- DropIndex
DROP INDEX "detections_organization_id_idx";

-- DropIndex
DROP INDEX "incidents_organization_id_idx";

-- DropIndex
DROP INDEX "incidents_team_id_idx";

-- DropIndex
DROP INDEX "users_organization_id_idx";

-- DropIndex
DROP INDEX "users_team_id_idx";

-- AlterTable
ALTER TABLE "detections" ADD COLUMN     "team_id" TEXT;

-- CreateIndex
CREATE INDEX "alerts_org_team_idx" ON "alerts"("organization_id", "team_id");

-- CreateIndex
CREATE INDEX "cameras_org_team_idx" ON "cameras"("organization_id", "team_id");

-- CreateIndex
CREATE INDEX "detections_org_team_timestamp_idx" ON "detections"("organization_id", "team_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "incidents_org_team_idx" ON "incidents"("organization_id", "team_id");

-- CreateIndex
CREATE INDEX "users_org_team_idx" ON "users"("organization_id", "team_id");

-- AddForeignKey
ALTER TABLE "detections" ADD CONSTRAINT "detections_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the denormalized team_id from each detection's camera team so
-- existing tenants immediately benefit from the team-scoped hot-path index.
UPDATE "detections" d
SET "team_id" = c."team_id"
FROM "cameras" c
WHERE d."camera_id" = c."id"
  AND d."team_id" IS NULL
  AND c."team_id" IS NOT NULL;
