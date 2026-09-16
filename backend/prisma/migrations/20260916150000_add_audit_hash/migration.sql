-- Audit-log tamper detection: each row carries an SHA-256 stamp computed over
-- its own immutable identity plus the audit fields. A row whose stamp no
-- longer matches is evidence of modification after the fact.

ALTER TABLE "audit_logs" ADD COLUMN "hash" TEXT;