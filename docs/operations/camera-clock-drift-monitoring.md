# Camera Clock Drift Monitoring Guide

## Purpose
Help identify timestamp differences between camera sources and VigiLens services that can affect event ordering and investigations.

## Review
- Establish whether each camera timestamp is used or whether server receive time is authoritative.
- Compare camera time with a trusted reference during an approved test.
- Record drift magnitude and direction.
- Check whether drift changes after camera reboot or network interruption.
- Verify timezone and daylight-saving configuration where applicable.

## Test cases
- Camera and server clocks are synchronized.
- Camera clock is deliberately offset in a controlled test.
- Frames arrive late or out of order.
- Camera restarts and resumes streaming.

## Response
Document the affected source, observed drift, operational impact, and corrective action. Avoid silently changing historical event timestamps. Do not claim clock synchronization is healthy without measured evidence.
