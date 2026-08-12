-- Detector Management Center:
--  * DetectorSettings gains an alert cooldown (ms) so it can be configured per detector.
--  * DetectorCamera gains a per-camera enable flag (assign but disable a feed).
--  * New detector-specific audit actions for the management center.
ALTER TABLE "detector_settings" ADD COLUMN "alert_cooldown_ms" INTEGER NOT NULL DEFAULT 30000;

ALTER TABLE "detector_cameras" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TYPE "AuditLogAction" ADD VALUE 'detector_created';
ALTER TYPE "AuditLogAction" ADD VALUE 'detector_updated';
ALTER TYPE "AuditLogAction" ADD VALUE 'detector_deleted';
ALTER TYPE "AuditLogAction" ADD VALUE 'detector_enabled';
ALTER TYPE "AuditLogAction" ADD VALUE 'detector_disabled';
ALTER TYPE "AuditLogAction" ADD VALUE 'detector_config_updated';
ALTER TYPE "AuditLogAction" ADD VALUE 'detector_cameras_updated';