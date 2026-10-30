# Event Timestamp and Time Synchronization Checks

## Purpose
Ensure event timing remains understandable across camera sources, backend services, and stored records.

## Review
- Confirm the documented timezone convention for API responses and stored timestamps.
- Check that services use synchronized system clocks.
- Verify whether camera-provided timestamps or server receive times are authoritative for each workflow.
- Confirm timestamps are consistently represented in logs and event records.
- Check behavior for missing, malformed, or out-of-order timestamps.

## Test cases
- Normal event with a valid timestamp.
- Event arriving after a network delay.
- Missing or invalid source timestamp.
- Service clock offset in a controlled test environment.
- Daylight-saving or timezone display boundary, where relevant to the deployment.

## Reporting
Record the source timestamp, receive timestamp, stored value, and displayed value for synthetic test events. Avoid silently rewriting event history to hide clock discrepancies.
