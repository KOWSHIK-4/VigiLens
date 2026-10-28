# Frontend and API Compatibility Checks

## Goal
Catch contract mismatches between the VigiLens frontend and backend before release.

## Checks
- Confirm the frontend uses the intended API base URL for the environment.
- Verify login and authenticated requests use the documented response and credential format.
- Check that loading, empty, success, and error states are handled for key screens.
- Verify list and detail views tolerate missing optional fields as documented.
- Confirm unauthorized and expired-session responses lead to safe, understandable behavior.
- Check that API errors do not expose stack traces or secret values in the UI.
- Confirm WebSocket or live-update behavior, if used, reconnects safely and does not duplicate displayed events.

## Test process
Use a staging or local environment with test accounts and synthetic events. Record the frontend version, backend version, browser, and observed results.

## Acceptance
Critical user flows should match the documented API contract. Mark untested paths clearly; a written checklist alone does not prove compatibility.
