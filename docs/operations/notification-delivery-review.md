# Notification Delivery Review Guide

## Purpose
Help operators review notification delivery from detection event to final delivery status, where notifications are configured.

## Trace a test event
- Use a synthetic event with a known identifier and timestamp.
- Confirm the event is created and persisted as expected.
- Check whether a notification is queued or attempted by the configured integration.
- Review the provider response or delivery status where available.
- Confirm failures are visible and can be investigated without exposing provider credentials.

## Failure cases
- Provider unavailable or timeout.
- Invalid destination or configuration.
- Retry after a transient error.
- Repeated event delivery.
- Notification accepted by the provider but not confirmed as delivered, if status tracking exists.

## Safety
Do not use real emergency contacts or send unapproved messages during tests. Keep tokens and destination details out of logs and reports.

## Acceptance
Record expected versus observed behavior and identify any untested integration. Do not claim end-to-end delivery is verified unless the complete configured path was exercised.
