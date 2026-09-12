-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('new', 'acknowledged', 'investigating', 'resolved', 'reopened');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditLogAction" ADD VALUE 'incident_created';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_status_changed';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_assigned';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_unassigned';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_note_added';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_reopened';
ALTER TYPE "AuditLogAction" ADD VALUE 'incident_resolved';

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'new',
    "priority" "AlertSeverity" NOT NULL DEFAULT 'info',
    "assigned_to_user_id" TEXT,
    "assigned_to_name" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),
    "investigating_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" TEXT,
    "resolved_by_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_notes" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_activity" (
    "id" TEXT NOT NULL,
    "incident_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_alert_id_key" ON "incidents"("alert_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_priority_idx" ON "incidents"("priority");

-- CreateIndex
CREATE INDEX "incidents_assigned_to_user_id_idx" ON "incidents"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "incidents_opened_at_idx" ON "incidents"("opened_at");

-- CreateIndex
CREATE INDEX "incidents_created_at_idx" ON "incidents"("created_at");

-- CreateIndex
CREATE INDEX "incident_notes_incident_id_idx" ON "incident_notes"("incident_id");

-- CreateIndex
CREATE INDEX "incident_notes_created_at_idx" ON "incident_notes"("created_at");

-- CreateIndex
CREATE INDEX "incident_activity_incident_id_idx" ON "incident_activity"("incident_id");

-- CreateIndex
CREATE INDEX "incident_activity_created_at_idx" ON "incident_activity"("created_at");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_notes" ADD CONSTRAINT "incident_notes_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_activity" ADD CONSTRAINT "incident_activity_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
