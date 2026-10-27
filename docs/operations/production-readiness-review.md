# VigiLens Production Readiness Review

Use this review before exposing a deployment to real users or camera feeds.

## Security
- Confirm authentication and role-based authorization are enabled.
- Remove demo credentials and rotate any secret that may have been exposed.
- Review CORS, host port bindings, TLS termination, and administrative endpoints.
- Confirm logs and error responses do not reveal secrets or unnecessary personal data.

## Reliability
- Confirm service health checks and restart behavior are appropriate.
- Verify database backup and restoration procedures in a safe environment.
- Document camera outage handling and recovery.
- Define alert ownership and incident escalation paths.

## Application validation
- Run the available automated tests and record their results.
- Smoke-test login, role restrictions, camera ingestion, detection, event persistence, and alert delivery where supported.
- Check invalid input and dependency failure paths.
- Verify deployment configuration and migrations for the target environment.

## Operations
- Define monitoring signals and actionable thresholds.
- Document release, rollback, and recovery procedures.
- Confirm data retention and deletion requirements.
- Assign owners for open risks and exceptions.

## Decision
Record pass, fail, or not tested for each applicable item. Production readiness must be based on observed evidence; this checklist is not itself proof that the system is secure or operational.
