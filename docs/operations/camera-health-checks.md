# Camera Health Monitoring Runbook

## Purpose
Use this checklist to distinguish a disconnected camera from a detector or application failure.

## Routine checks
- Confirm the camera is powered and reachable from the host running VigiLens.
- Verify the configured camera source is correct; do not put credentials in screenshots, logs, or documentation.
- Check the backend and AI-service logs for connection, decoding, and frame-processing errors.
- Confirm the most recent frame timestamp advances while the camera is expected to be active.
- Confirm the UI reports a clear unavailable or stale state instead of presenting an old frame as live.

## Recovery
1. Record the time the issue began and the affected camera identifier.
2. Check power, network reachability, and source configuration.
3. Restart only the affected service when safe; avoid restarting the full stack before collecting useful logs.
4. Verify that fresh frames resume and alerts return to normal.
5. Record the cause, action taken, and follow-up prevention work.

## Acceptance criteria
- A disconnected source is surfaced as unavailable.
- Stale frames are not represented as current.
- Recovery is verified using a new frame timestamp.
- Secrets and raw camera credentials are excluded from incident notes.
