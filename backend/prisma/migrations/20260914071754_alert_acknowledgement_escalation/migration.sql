-- AlterTable
ALTER TABLE "alerts" ADD COLUMN     "acknowledged_at" TIMESTAMP(3),
ADD COLUMN     "acknowledged_by_id" TEXT,
ADD COLUMN     "acknowledged_by_name" TEXT,
ADD COLUMN     "escalated_at" TIMESTAMP(3),
ADD COLUMN     "escalated_by_id" TEXT,
ADD COLUMN     "escalated_by_name" TEXT,
ADD COLUMN     "escalation_note" TEXT;

-- CreateIndex
CREATE INDEX "alerts_acknowledged_at_idx" ON "alerts"("acknowledged_at");

-- CreateIndex
CREATE INDEX "alerts_escalated_at_idx" ON "alerts"("escalated_at");
