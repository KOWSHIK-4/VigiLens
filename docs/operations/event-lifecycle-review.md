# Detection Event Lifecycle Review

## Purpose
Review how a VigiLens detection event moves from creation through review, acknowledgement, and closure where those states are implemented.

## Lifecycle checks
- Confirm event identifiers are stable and unique.
- Verify creation time and source camera metadata are preserved.
- Check that severity and detector details are populated as documented.
- Confirm acknowledgement records the intended user and time where supported.
- Verify state transitions follow the allowed workflow.
- Check whether closed or dismissed events remain auditable according to policy.
- Ensure duplicate processing does not silently overwrite a distinct event.

## Test approach
Use synthetic events and dedicated test accounts in a non-production environment. Exercise normal transitions, invalid transitions, repeated requests, and persistence failures.

## Evidence
Record expected and observed state, event identifier, actor role, and relevant sanitized logs. Do not assume a lifecycle state or feature exists unless confirmed in the deployed application.
