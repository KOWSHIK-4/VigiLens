# Health Endpoint Verification Guide

## Goal
Verify that service health checks communicate meaningful readiness and availability for VigiLens.

## Review
- Identify the documented health or readiness endpoint for each service.
- Confirm a healthy response means the service can perform its required role, not only that its process exists.
- Check whether database or required dependency failures are reflected appropriately.
- Ensure health responses do not reveal secrets, internal credentials, or sensitive environment configuration.
- Confirm container health checks use reasonable timeouts, intervals, and retry counts for the service.

## Test cases
- Service starts normally.
- Required dependency is unavailable.
- Service is still starting and not yet ready.
- Service recovers after the dependency becomes available again.
- Health endpoint returns an unexpected error.

## Acceptance record
Record service, environment, expected behavior, observed result, and any follow-up. Run these checks in a safe environment and do not claim the deployed system passed without evidence.
