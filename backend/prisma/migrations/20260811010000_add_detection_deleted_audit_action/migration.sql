-- Add the detection_deleted audit action so detection deletions are audited.
ALTER TYPE "AuditLogAction" ADD VALUE 'detection_deleted';
