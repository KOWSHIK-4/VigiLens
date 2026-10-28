# Logging and Audit Review Checklist

## Purpose
Review whether operational logs and audit records are useful, appropriately protected, and free of unnecessary sensitive data.

## Operational logging
- Include timestamps, service names, severity, and correlation identifiers where available.
- Log meaningful startup, dependency, processing, and failure events.
- Ensure errors include enough context to troubleshoot without exposing secrets.
- Check that repeated failures do not flood storage or obscure important events.
- Confirm log rotation and retention are configured for the deployment.

## Audit records
- Review coverage for authentication, role changes, administrative actions, and security-relevant configuration changes where supported.
- Confirm audit records identify the action and outcome without storing passwords or token values.
- Restrict log access to authorized personnel.
- Check time synchronization and timestamp consistency across services.

## Validation
Use synthetic events to confirm expected entries are created. Verify that sensitive values are redacted and that logs remain accessible during an approved incident investigation.

## Evidence
Record the environment, reviewed log sources, findings, and remediation items. Do not claim audit coverage is complete without checking the deployed implementation.
