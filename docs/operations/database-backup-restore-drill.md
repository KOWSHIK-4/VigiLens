# Database Backup and Restore Drill

## Goal
Verify that the deployment's database backup process can support recovery, not just that a backup file exists.

## Before the drill
- Confirm the approved backup location and retention policy.
- Record the database environment and backup timestamp.
- Use a non-production environment and an authorized test dataset.
- Ensure credentials are supplied through the approved secret mechanism, not pasted into logs or notes.

## Restore procedure
1. Select a backup that falls within the documented recovery window.
2. Restore it into an isolated test database using the deployment's documented procedure.
3. Confirm the database starts and the expected schema is present.
4. Check representative records and relations without exposing sensitive data.
5. Run the project's migration/status check where applicable.
6. Record elapsed restore time and any missing or inconsistent data.

## Pass criteria
- Restore completes without unexplained errors.
- Schema and representative data are usable.
- The measured recovery time and data point are recorded.
- The test does not overwrite production data.

## Record
Document the backup identifier, test environment, start/end times, result, issues, and follow-up owner. Do not claim a backup is recoverable until a restore has been tested.
