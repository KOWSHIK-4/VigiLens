# Queue and Worker Recovery Guide

## Purpose
Provide a consistent approach for investigating delayed or stuck background processing, if the deployment uses a queue or worker service.

## Initial checks
- Confirm the API can submit work and inspect worker health.
- Check queue depth, oldest-item age, processing rate, and failure counts where telemetry exists.
- Review sanitized logs for dependency errors, timeouts, and repeated retries.
- Determine whether the issue affects all jobs or one job type.
- Avoid clearing queues or deleting records before understanding the impact.

## Recovery
1. Capture timestamps and representative job identifiers.
2. Check required dependencies and worker configuration.
3. Apply the documented retry or restart procedure.
4. Verify queued work resumes and failure rates return to baseline.
5. Confirm that retries do not create unintended duplicate events.

## Escalation
Escalate persistent backlog, data loss risk, or repeated worker crashes with relevant sanitized evidence.

## Note
Adapt this guide to the actual architecture. If VigiLens does not use a queue/worker for a path, mark that section not applicable rather than assuming such a component exists.
