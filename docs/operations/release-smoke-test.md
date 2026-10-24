# Post-Deployment Smoke Test

Run this checklist after a VigiLens deployment in a test or approved environment.

## Core service checks
- Confirm containers or services reach their expected healthy state.
- Confirm the backend can connect to its configured database.
- Confirm the frontend loads and can reach the intended backend URL.
- Confirm health endpoints return the documented status without exposing sensitive configuration.

## Camera and inference checks
- Use an approved test source or camera.
- Confirm frames are received and timestamps advance.
- Confirm the detector produces an expected result for a known test input.
- Confirm invalid, missing, or stale input is handled safely.

## API and access checks
- Verify an authorized user can perform an allowed action.
- Verify an unauthorized request is rejected.
- Verify validation and rate-limit behavior for representative invalid or excessive requests.
- Confirm logs do not contain tokens, passwords, or raw camera credentials.

## Alerting and persistence
- Confirm a test event is recorded as expected.
- Confirm delivery or notification status is observable.
- Confirm repeated delivery does not create unintended duplicate events, where deduplication is supported.

## Result
Record pass/fail, deployment version, environment, test time, and any issue links. Do not mark the release as verified if a critical check was skipped or failed.
