# Camera Stream Performance Checks

## Purpose
Provide a repeatable way to review camera ingest quality and processing performance in a VigiLens deployment.

## Baseline
- Record the camera/source type and test environment.
- Measure the expected frame rate and the observed arrival rate.
- Track frame timestamps to identify delays or stale input.
- Observe inference latency and end-to-end delay where metrics are available.
- Record CPU, memory, and network conditions during the test.

## Test cases
- Normal steady stream.
- Temporary network delay or source interruption.
- Recovery after reconnect.
- Lower-than-expected frame rate.
- Invalid or stale frames.

## Review
Compare results against targets defined for the deployment. Check whether the UI clearly distinguishes live, delayed, and unavailable sources. Do not treat missing metrics as evidence of good performance.

## Report
Record the workload, duration, measured values, environment, and any regression. Use approved test streams and avoid including credentials or unnecessary camera imagery in the report.
