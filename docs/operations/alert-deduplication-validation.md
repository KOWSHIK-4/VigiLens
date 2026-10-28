# Alert Deduplication Validation Plan

## Goal
Verify that repeated processing or delivery does not create confusing duplicate VigiLens alerts when deduplication is part of the implementation.

## Test scenarios
- Submit the same synthetic event more than once.
- Retry delivery after a simulated transient failure.
- Submit two distinct events from the same camera close together.
- Restart the relevant service during a test event, where safe.
- Confirm that genuinely distinct events remain separately identifiable.

## Review
- Identify which event fields are used to recognize duplicates.
- Check how the deduplication window is configured, if applicable.
- Confirm retry behavior is documented and observable.
- Verify the user interface communicates duplicate or already-processed status consistently.
- Check logs for correlation identifiers and avoid recording secrets.

## Acceptance
Record expected versus observed behavior for each case. Do not assume deduplication exists or is correct until the deployed implementation has been tested. Use synthetic data and a non-production environment.
