# Backup and Restore Ownership

## Purpose
Make backup and recovery responsibilities clear for each VigiLens deployment.

## Ownership
- Assign an owner for backup configuration and schedule review.
- Assign an owner for restore testing and recovery approval.
- Document where backup status and failures are monitored.
- Identify who can access backup storage and who can authorize restoration.
- Record escalation contacts without including private credentials.

## Evidence to retain
- Backup job outcome and timestamp.
- Backup identifier and retention expiry.
- Restore drill date, environment, and result.
- Recovery time and any data gap observed.
- Open remediation items and responsible owner.

## Operational safeguards
- Restrict backup access to authorized roles.
- Protect backups in transit and at rest according to deployment policy.
- Keep production restore tests isolated unless a formally approved recovery event requires otherwise.
- Do not treat a successful backup job as proof that a restore will succeed.

Review this ownership record periodically and after team or infrastructure changes.
