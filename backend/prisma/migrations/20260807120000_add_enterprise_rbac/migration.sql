-- Enterprise RBAC enhancements
-- 1) Promote the fixed RoleValue enum to a flexible, string-backed role model
--    so administrators can create custom roles. Data is preserved during the
--    enum -> text conversion by dropping constraints first, casting in place,
--    then restoring constraints.

ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_role_name_fkey";

ALTER TABLE "roles" ALTER COLUMN "name" TYPE TEXT USING "name"::text;

ALTER TABLE "role_permissions" ALTER COLUMN "role_name" TYPE TEXT USING "role_name"::text;

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'operator';

DROP TYPE "RoleValue";

ALTER TABLE "role_permissions"
  ADD CONSTRAINT "role_permissions_role_name_fkey" FOREIGN KEY ("role_name") REFERENCES "roles"("name") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users"
  ADD CONSTRAINT "users_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("name") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) Account lifecycle fields: soft delete, lock state, and forced password change
ALTER TABLE "users"
  ADD COLUMN "is_locked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "users_deleted_at_idx" ON "users"("deleted_at");

-- 3) New audit log actions for account lifecycle and role administration
ALTER TYPE "AuditLogAction" ADD VALUE 'password_changed';
ALTER TYPE "AuditLogAction" ADD VALUE 'user_locked';
ALTER TYPE "AuditLogAction" ADD VALUE 'user_unlocked';
ALTER TYPE "AuditLogAction" ADD VALUE 'role_created';
ALTER TYPE "AuditLogAction" ADD VALUE 'role_updated';
ALTER TYPE "AuditLogAction" ADD VALUE 'role_deleted';
