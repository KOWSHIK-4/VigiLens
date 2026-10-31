# Inference Failure Handling Checks

## Goal
Review how VigiLens behaves when detector inference cannot complete successfully.

## Scenarios
- Model artifact is missing or cannot be loaded.
- Input frame is empty, malformed, or unsupported.
- Inference exceeds the configured processing timeout.
- AI service dependency is unavailable.
- Model returns an unexpected or invalid result.
- Resource pressure interrupts normal processing.

## Expected behavior to verify
- Failures are logged with useful context and a correlation identifier where available.
- A failed inference is not represented as a successful detection.
- The affected camera or processing status is visible to operators.
- Recovery occurs when the underlying problem is corrected.
- Repeated failures do not cause uncontrolled retries or resource exhaustion.

## Test approach
Use synthetic frames and an isolated environment. Record the model/configuration version, failure injected, observed response, and recovery result.

Do not expose model credentials, private images, or sensitive configuration in test reports. Mark untested scenarios clearly.
