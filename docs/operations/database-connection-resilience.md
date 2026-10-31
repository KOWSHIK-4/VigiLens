# Database Connection Resilience Checks

## Purpose
Review VigiLens behavior during temporary database connectivity problems.

## Test scenarios
- Database is healthy during application startup.
- Database is unavailable during startup.
- Connection drops while the application is running.
- Database becomes available again after an outage.
- Connection pool capacity is reached under a controlled test load.

## Review
- Confirm health/readiness reporting reflects required database availability.
- Check that failed writes are surfaced rather than reported as successful.
- Verify retry behavior is bounded and appropriate for the operation.
- Confirm connections are released and recovered correctly.
- Check logs for useful diagnostics without SQL credentials or sensitive record contents.

## Recovery verification
After restoring the database, verify the application reconnects and new test operations succeed. Check whether any interrupted operation needs safe replay or reconciliation.

## Evidence
Record environment, outage duration, observed errors, recovery time, and data consistency results. Do not run destructive failure tests against production.
