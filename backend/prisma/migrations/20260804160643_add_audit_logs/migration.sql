-- CreateEnum
CREATE TYPE "AuditLogAction" AS ENUM ('user_login', 'user_logout', 'password_reset', 'user_created', 'user_updated', 'user_deleted', 'role_changed', 'camera_added', 'camera_updated', 'camera_deleted', 'camera_started', 'camera_stopped', 'ai_model_enabled', 'ai_model_disabled', 'ai_model_updated', 'detection_created', 'alert_created', 'report_generated', 'settings_changed');

-- CreateEnum
CREATE TYPE "AuditLogStatus" AS ENUM ('success', 'failed');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT,
    "username" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "action" "AuditLogAction" NOT NULL,
    "module" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL DEFAULT '',
    "user_agent" TEXT NOT NULL DEFAULT '',
    "status" "AuditLogStatus" NOT NULL DEFAULT 'success',
    "metadata" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_module_idx" ON "audit_logs"("module");

-- CreateIndex
CREATE INDEX "audit_logs_status_idx" ON "audit_logs"("status");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_email_idx" ON "audit_logs"("email");
