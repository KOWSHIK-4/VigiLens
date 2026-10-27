# Camera Onboarding Checklist

## Before connecting
- Obtain authorization to connect and process the camera feed.
- Assign a stable camera identifier and record its intended location in the approved inventory.
- Confirm network reachability and compatibility with the configured source type.
- Store credentials using the approved secret mechanism.
- Limit camera network access to the required hosts and ports.

## Configuration
- Set the source endpoint and relevant connection options without committing credentials.
- Confirm the selected detector and thresholds match the intended use case.
- Document expected frame rate and any source-specific constraints.
- Ensure the camera's data retention and access rules are understood.

## Validation
- Confirm the camera connects and fresh frame timestamps advance.
- Check behavior for disconnects, malformed frames, and stale input.
- Verify that events are associated with the correct camera identifier.
- Confirm alerts and status indicators behave as expected.
- Review sanitized logs for connection or decoding errors.

## Handover
Record owner, validation date, configuration reference (not secret values), known limitations, and support contact. Do not mark onboarding complete until a real authorized test feed has been checked.
