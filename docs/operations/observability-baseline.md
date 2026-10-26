# Service Observability Baseline

## Purpose
Define the minimum signals operators should review when troubleshooting VigiLens.

## Backend
- Request volume and response status codes.
- Request latency and repeated server errors.
- Authentication and authorization failures.
- Database connection and query failures.
- Health-check status and restart history.

## AI and camera processing
- Camera connection state and latest-frame timestamp.
- Frame processing rate and inference latency.
- Invalid or stale frame counts, where instrumented.
- Detector errors and model/configuration version.
- Alert creation and delivery outcomes.

## Frontend
- API connectivity failures.
- Visible loading or unavailable states.
- Client-side errors that affect core workflows.

## Logging guidance
- Include timestamps and a correlation or event identifier when available.
- Use consistent severity levels.
- Sanitize credentials, tokens, and unnecessary personal data.
- Avoid logging full image payloads or secrets.

## Review
Choose thresholds appropriate to the deployment and establish a baseline before alerting. Treat missing telemetry as a visibility gap, not proof that a service is healthy.
