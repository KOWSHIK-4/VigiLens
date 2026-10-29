# Test Data and Fixture Guidelines

## Purpose
Keep VigiLens development and verification repeatable while protecting camera data and credentials.

## Fixture principles
- Prefer synthetic events and generated metadata for routine tests.
- Use approved sample images or streams only when visual inference behavior must be tested.
- Keep fixtures small, deterministic, and documented.
- Include representative valid, invalid, missing-field, boundary, and stale-input cases.
- Avoid embedding real user information, production snapshots, or access credentials.

## Repeatability
- Record fixture version and expected result.
- Fix random seeds when the test framework supports it and determinism matters.
- Keep environment-specific values in test configuration, not in committed fixtures.
- Ensure tests clean up temporary records and files when appropriate.

## Review
- Check that fixtures do not contain secrets or restricted data before committing.
- Confirm tests do not call real notification recipients or production endpoints.
- Refresh expected outputs deliberately when behavior changes.

## Evidence
Document the test command, environment, result, and limitations. A fixture passing locally does not guarantee production behavior.
