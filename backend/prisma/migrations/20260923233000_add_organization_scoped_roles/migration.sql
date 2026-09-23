-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_role_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_role_name_fkey";

-- AlterTable: give every role a stable surrogate id (deterministic so the
-- backfill is reproducible) and add the organization scope. System roles
-- stay global (organization_id NULL); tenant-created custom roles carry
-- their organization id and are unique per (organization_id, name).
ALTER TABLE "roles" DROP CONSTRAINT "roles_pkey";
ALTER TABLE "roles" ADD COLUMN     "id" TEXT;
UPDATE "roles" SET "id" = 'role-' || "name";
ALTER TABLE "roles" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "roles" ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
ALTER TABLE "roles" ADD COLUMN     "organization_id" TEXT;

-- AlterTable: repoint role_permissions to the surrogate role id.
ALTER TABLE "role_permissions" ADD COLUMN     "role_id" TEXT;
UPDATE "role_permissions" rp
SET "role_id" = r."id"
FROM "roles" r
WHERE rp."role_name" = r."name";
ALTER TABLE "role_permissions" ALTER COLUMN "role_id" SET NOT NULL;
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_pkey";
ALTER TABLE "role_permissions" DROP COLUMN "role_name";
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id");

-- CreateIndex
CREATE INDEX "roles_organization_id_idx" ON "roles"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_organization_id_name_key" ON "roles"("organization_id", "name");

-- CreateIndex
CREATE INDEX "role_permissions_role_id_idx" ON "role_permissions"("role_id");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;