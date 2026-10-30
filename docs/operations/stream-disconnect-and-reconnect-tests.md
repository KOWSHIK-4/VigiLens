# Stream Disconnect and Reconnect Verification Plan

## Purpose
Verify how a VigiLens camera source behaves when connectivity is interrupted and restored.

## Test setup
- Use an authorized test camera or synthetic stream in a non-production environment.
- Record the source identifier, expected frame rate, and test window.
- Confirm that test credentials are stored outside version control.

## Scenarios
1. Start with a stable stream and confirm frame timestamps advance.
2. Interrupt the source connection and observe the reported camera state.
3. Keep the source unavailable long enough to detect stale-frame handling.
4. Restore connectivity and verify that fresh frames resume.
5. Repeat the interruption to check for repeated errors or unstable recovery.

## Expected observations
- A disconnected source is not represented as live.
- The last-frame timestamp remains distinguishable from current activity.
- Recovery is visible and does not require unsafe manual data changes.
- Logs provide useful diagnostics without exposing credentials.

## Report
Record timings, observed states, relevant sanitized logs, and any defects. Do not claim reconnect behavior is verified until the test has been run.
