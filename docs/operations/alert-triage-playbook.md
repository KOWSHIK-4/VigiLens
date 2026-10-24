# Alert Triage Playbook

## Purpose
Provide a consistent first response to VigiLens detection alerts.

## Triage sequence
1. Review the alert timestamp, camera/source, severity, and event identifier.
2. Check whether the event is duplicated or already acknowledged.
3. Verify that the camera was producing fresh frames at the event time.
4. Compare the alert with the configured detection thresholds and relevant application logs.
5. Escalate high-severity or repeated events according to the deployment's incident procedure.

## Evidence to capture
- Event identifier and timestamps, including timezone.
- Affected service and camera identifier.
- Relevant sanitized log excerpts and observed behavior.
- Whether the event was confirmed, a false positive, or could not be verified.
- Actions taken and the person or team receiving the handoff.

## Safety and privacy
- Follow the deployment's retention policy for images and snapshots.
- Share only the minimum evidence needed to investigate.
- Never paste passwords, tokens, or camera credentials into an issue or report.

## Closure checklist
- Outcome and rationale are documented.
- Any service degradation is resolved or tracked.
- Follow-up work has an owner and a clear verification step.
