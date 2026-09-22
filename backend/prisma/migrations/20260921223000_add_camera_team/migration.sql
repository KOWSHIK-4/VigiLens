-- AlterTable
ALTER TABLE "cameras" ADD COLUMN     "team_id" TEXT;

-- CreateIndex
CREATE INDEX "cameras_team_id_idx" ON "cameras"("team_id");

-- AddForeignKey
ALTER TABLE "cameras" ADD CONSTRAINT "cameras_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;