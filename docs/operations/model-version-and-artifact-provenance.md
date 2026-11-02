# Model Artifact Provenance Checks

## Purpose
Keep track of which AI model artifact and configuration were used by a VigiLens deployment.

## Record for each release
- Model name and version or immutable artifact identifier.
- Source repository revision or approved artifact location.
- Checksum where the artifact distribution process supports it.
- Detector configuration and threshold version.
- Runtime/library version and target hardware where relevant.
- Approval owner and date.

## Verification
- Confirm the deployed artifact matches the approved identifier.
- Check that the artifact is obtained from an approved source.
- Ensure model files are not replaced silently between deployments.
- Keep credentials and private storage URLs out of committed records.
- Record the previous known-good artifact for rollback.

## Important
Do not claim an artifact is authentic or reproducible based only on its filename. Verify the checksum or trusted provenance using the deployment's actual release process.
