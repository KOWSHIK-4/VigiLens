-- AlterEnum
ALTER TYPE "AuditLogAction" ADD VALUE 'alert_team_assigned';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_team_assigned';

-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "team_id" TEXT;

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "team_id" TEXT;

-- CreateIndex
CREATE INDEX "alerts_team_id_idx" ON "alerts"("team_id");

-- CreateIndex
CREATE INDEX "incidents_team_id_idx" ON "incidents"("team_id");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;