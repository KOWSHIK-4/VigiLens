-- DropIndex
DROP INDEX "system_settings_category_idx";

-- DropIndex
DROP INDEX "system_settings_category_key_key";

-- AlterTable
ALTER TABLE "system_settings" ADD COLUMN     "organization_id" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "system_settings_organization_id_category_idx" ON "system_settings"("organization_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_organization_id_category_key_key" ON "system_settings"("organization_id", "category", "key");

