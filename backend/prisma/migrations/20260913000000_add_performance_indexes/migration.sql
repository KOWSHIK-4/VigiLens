-- Composite indexes for the most common filter-plus-sort query paths.
-- Single-column indexes already exist (see schema.prisma); the composites cut
-- the separate sort step for filtered lists (alerts, detections, incidents,
-- audit logs, incident notes/activity). Same convention as
-- 20260823000000_add_detection_composite_indexes.

-- CreateIndex
CREATE INDEX "alerts_is_read_created_at_idx" ON "alerts"("is_read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "alerts_severity_created_at_idx" ON "alerts"("severity", "created_at" DESC);

-- CreateIndex
CREATE INDEX "detections_status_timestamp_idx" ON "detections"("status", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "incidents_status_opened_at_idx" ON "incidents"("status", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_priority_opened_at_idx" ON "incidents"("priority", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "incidents_assigned_to_user_id_opened_at_idx" ON "incidents"("assigned_to_user_id", "opened_at" DESC);

-- CreateIndex
CREATE INDEX "incident_notes_incident_id_created_at_idx" ON "incident_notes"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "incident_activity_incident_id_created_at_idx" ON "incident_activity"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_timestamp_idx" ON "audit_logs"("user_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_status_timestamp_idx" ON "audit_logs"("status", "timestamp" DESC);