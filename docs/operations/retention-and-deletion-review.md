# Retention and Deletion Review Checklist

## Purpose
Check that VigiLens event records, snapshots, logs, and backups follow the deployment's approved retention rules.

## Review
- Identify the configured retention period for each data category.
- Confirm that event metadata and image/snapshot retention are understood separately.
- Verify deletion jobs or lifecycle rules are configured where supported.
- Check that backup retention is documented independently from live-data retention.
- Confirm access to retained data is restricted to authorized roles.
- Review whether legal, incident-response, or operational holds apply before deleting records.

## Validation
- Use a non-production test record to verify the expected expiry or deletion behavior.
- Confirm the application does not present deleted data as available.
- Check logs for deletion failures without exposing the content being deleted.
- Record exceptions and their owners.

## Privacy
Retain only the data needed for the stated purpose. Do not place real camera images or personal data in test reports unless explicitly authorized.

## Evidence
Record the policy version, environment, test date, outcome, and remediation items. Do not claim deletion is verified unless the behavior was tested.
