# Observability Alert Threshold Review

## Purpose
Review whether operational alerts are actionable and proportionate for a VigiLens deployment.

## Signals to consider
- API error rate and request latency.
- AI inference latency and failure rate.
- Camera disconnects, stale frames, and ingest delay.
- Database connectivity and query failures.
- Notification delivery failures where integrations are enabled.
- Container restarts, memory pressure, and storage capacity.

## Threshold review
- Set thresholds using an observed baseline and service requirements.
- Distinguish warning conditions from urgent service-impacting failures.
- Add a clear owner and response action to each alert.
- Avoid alert rules that trigger repeatedly for the same unresolved condition.
- Review for missing alerts after incidents and noisy alerts during normal operation.

## Validation
Use safe test conditions to confirm alerts trigger and recover as expected. Record the signal, threshold, test method, notification path, and result.

Do not invent service-level objectives or claim alert coverage is complete without deployment-specific measurements and tests.
