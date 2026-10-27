# API Error Contract Review Guide

## Goal
Keep API failures predictable for frontend clients and safe for production use.

## Review points
- Verify successful responses use the documented response shape.
- Verify validation failures identify invalid input without echoing secrets.
- Verify unauthenticated and unauthorized requests return the intended status codes.
- Verify missing resources and conflicting operations are distinguishable where appropriate.
- Ensure unexpected server errors do not expose stack traces, environment variables, SQL details, or credentials.
- Confirm error responses are consistent across related endpoints.

## Client behavior
- The frontend should show a useful message for expected failures.
- Retry only operations that are safe to retry or have an idempotency strategy.
- Avoid infinite retry loops for authentication or validation errors.
- Preserve a correlation identifier when available so operators can locate sanitized logs.

## Verification record
Test representative success and failure cases in a safe environment. Document endpoint, expected status, observed result, and any deviation. Do not mark an endpoint verified without running the test.
