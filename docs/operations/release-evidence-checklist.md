# Release Verification Evidence Checklist

## Purpose
Make release decisions traceable by recording what was actually verified for a VigiLens change.

## Release identity
- Record the source revision, release tag or build identifier, and target environment.
- List the services and configuration areas changed.
- Identify the reviewer and verification date.

## Evidence
- Link automated test results and note any skipped or failing tests.
- Record build and deployment outcomes.
- Capture smoke-test results for relevant user workflows.
- Include security, migration, camera, inference, and notification checks when affected by the change.
- Record known limitations and unresolved risks.

## Decision
- Mark each check as passed, failed, blocked, or not tested.
- Do not treat missing evidence as a pass.
- Document approval and rollback criteria.
- Link defects and follow-up work to their owners.

## Handling
Use sanitized logs and synthetic test data where possible. Do not attach passwords, tokens, raw camera credentials, or unnecessary personal data.

This checklist supports release traceability; it does not certify a release as production-ready by itself.
