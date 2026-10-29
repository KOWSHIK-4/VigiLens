# Deployment Rollback Drill Guide

## Goal
Ensure the team understands how to return VigiLens to a known-good release if a deployment causes a regression.

## Preparation
- Identify the current release and the last known-good release.
- Review database migration compatibility and any irreversible data changes.
- Confirm backup and restore options where required.
- Define who approves the rollback and how success will be verified.
- Perform the drill in staging or another isolated environment.

## Drill
1. Deploy a representative release candidate.
2. Trigger the documented rollback procedure.
3. Confirm the expected application version is running.
4. Check health endpoints, login, API access, and a safe test camera/inference path where available.
5. Review logs for startup, schema, and configuration errors.
6. Record elapsed time and any manual intervention required.

## Important cautions
Do not assume application rollback also reverses database changes. Do not run a production rollback drill without an approved plan and clear impact assessment.

## Record
Capture versions, environment, steps, results, recovery time, and follow-up tasks. This guide does not mean a rollback has been tested.
