# Secrets Rotation Runbook

## When to rotate
Rotate credentials when exposure is suspected, access changes require it, or the defined rotation schedule is reached.

## Preparation
- Identify the affected secret and every service that consumes it.
- Confirm an authorized replacement and recovery procedure are available.
- Avoid placing secret values in tickets, terminal screenshots, or commit messages.
- Plan the order of updates to avoid unnecessary downtime.

## Rotation
1. Generate or obtain the new value through the approved secret-management process.
2. Update the secret store or deployment environment.
3. Restart or reload only the services that require it, following the deployment procedure.
4. Verify dependent services authenticate and perform expected health checks.
5. Revoke the old value once the new configuration is confirmed.

## Verification and cleanup
- Review sanitized logs for authentication failures.
- Confirm the old credential no longer works where revocation is supported.
- Check that local examples and committed files contain placeholders, not live secrets.
- Record the rotation time, affected components, and outcome without recording secret values.

If a secret was committed, rotate it first; deleting it from a later commit does not make the exposed value safe.
