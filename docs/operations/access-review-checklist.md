# Periodic Access Review Checklist

## Scope
Review user accounts, roles, service credentials, and administrative access for the VigiLens deployment.

## Review steps
- Export or inspect the current account and role inventory through approved administrative tools.
- Confirm each active account has a current business or operational need.
- Verify role assignments follow least privilege.
- Check for dormant, duplicate, test, or former-member accounts.
- Review privileged actions and recent role changes in audit records, where available.
- Confirm service credentials have an owner and documented rotation process.
- Verify that demo credentials are not enabled in production.

## Remediation
- Remove or reduce access only after confirming the owner and operational impact.
- Rotate credentials suspected of exposure.
- Record approvals for exceptions and give each exception an expiry or review date.
- Never put passwords, tokens, or secret values in the review report.

## Completion record
Capture the review date, scope, reviewer, findings, remediation tickets, and unresolved exceptions. Do not state that a control is implemented unless it has been verified in the deployed environment.
