-- AlterTable
ALTER TABLE "cameras" ADD COLUMN "last_snapshot_at" TIMESTAMP(3);

-- AlterEnum
ALTER TYPE "AuditLogAction" ADD VALUE 'camera_captured';
