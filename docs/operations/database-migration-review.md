# Database Migration Review Checklist

## Before applying a migration
- Read the migration SQL and identify schema, index, constraint, enum, and data changes.
- Check whether the change may lock large tables or require a maintenance window.
- Verify the migration is compatible with the application's deployment order.
- Confirm a recent backup exists and the restore process is understood.
- Identify any data backfill or manual step required.

## Validation
- Apply the migration in a disposable or staging environment first.
- Confirm the migration tool reports the expected state.
- Exercise application paths that read and write the affected tables.
- Review constraints, indexes, and representative records.
- Check startup logs for schema mismatch errors.

## Recovery
- Prefer a documented forward-fix when rollback could lose data.
- Do not manually edit migration history without a reviewed recovery plan.
- Record the exact migration identifier and action taken.

## Evidence
Capture migration version, environment, test outcome, and any limitations. Never report a migration as tested when it was only inspected.
