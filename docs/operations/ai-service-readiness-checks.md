# AI Service Readiness Verification

## Goal
Confirm that the VigiLens AI service is ready to accept inference work before dependent workflows are considered healthy.

## Startup checks
- Confirm the service process starts without model-loading errors.
- Verify the expected model artifact and configuration are available.
- Confirm required runtime dependencies and device configuration are valid.
- Check that readiness is not reported before initialization completes.
- Ensure health responses do not disclose file paths, credentials, or environment secrets.

## Runtime checks
- Submit an approved synthetic test input.
- Confirm the service returns a response matching the documented contract.
- Review inference latency and resource use under representative load.
- Check behavior for malformed input and unavailable model artifacts.
- Verify failure states are visible to dependent services.

## Recovery
After correcting a dependency or model issue, verify readiness transitions back to healthy and a new test inference succeeds.

Record service version, model identifier, environment, and actual results. Do not claim readiness has been tested unless these checks were executed.
