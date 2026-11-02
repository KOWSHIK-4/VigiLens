# Large Event Payload Review Checklist

## Goal
Review how VigiLens handles unusually large or malformed event payloads without degrading service availability.

## Checks
- Identify documented request and upload size limits.
- Confirm the API rejects payloads that exceed configured limits.
- Check validation for missing fields, unexpected types, and deeply nested input.
- Verify oversized requests do not cause excessive memory or CPU use.
- Confirm error responses are clear but do not expose internal implementation details.
- Check that rejected payloads are not partially persisted as successful events.

## Test approach
Use synthetic payloads in a local or staging environment. Increase payload size gradually and observe status codes, resource use, and logs.

## Safety
Do not use production camera data or send stress traffic to a live deployment without approval.

## Evidence
Record endpoint, test payload size, environment, expected result, observed result, and any issue. This checklist is not proof that limits are configured correctly.
