# Security Regression Test Plan

## Purpose
Provide a repeatable baseline for checking security-sensitive VigiLens workflows after relevant code or configuration changes.

## Authentication and authorization
- Verify unauthenticated requests to protected endpoints are rejected.
- Verify role restrictions are enforced by the backend.
- Check that users cannot access resources outside their authorized scope.
- Confirm invalid and expired credentials are handled safely.

## Input and API handling
- Test representative malformed and boundary inputs.
- Confirm validation errors do not reveal stack traces or internal secrets.
- Review rate limiting and request-size controls where configured.
- Check that unexpected errors are logged without sensitive payloads.

## Data and configuration
- Confirm secrets are supplied outside version control.
- Review access controls for event records and snapshots.
- Verify retention behavior against the deployment policy where applicable.
- Check that logs redact credentials and unnecessary personal data.

## Execution record
Run tests in an isolated environment with synthetic data. Record revision, test command, expected result, actual result, and defects. Mark skipped checks as not tested; this plan is not evidence that a security audit has passed.
