-- AlterTable
ALTER TABLE "teams" ADD COLUMN "lead_id" TEXT;

-- CreateIndex
CREATE INDEX "teams_lead_id_idx" ON "teams"("lead_id");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;