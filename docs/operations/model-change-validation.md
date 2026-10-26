# Detector Model Change Validation Plan

## Purpose
Provide a repeatable review before promoting a detector model or its configuration.

## Preparation
- Record the model artifact identifier, version, and checksum when available.
- Record relevant inference settings and thresholds.
- Use an approved, representative validation dataset with documented handling permissions.
- Keep the previous known-good model/configuration available for rollback.

## Validation
- Run the same evaluation inputs against the current and proposed versions.
- Record the number of samples and the evaluation conditions.
- Review false positives, false negatives, and class-specific results where labels support them.
- Measure inference latency and resource use on the target-like environment.
- Check behavior for empty, malformed, low-quality, and stale inputs.
- Confirm that logs and output artifacts do not expose restricted images or personal data.

## Decision
- Compare results against acceptance criteria defined before the run.
- Document regressions, trade-offs, and any limitations in the test data.
- Do not promote a model solely because one aggregate metric improved.
- If a critical regression appears, hold the release and investigate.

## Report
Include model/config versions, dataset description, metrics, environment, date, decision, and reviewer. This checklist describes a validation process; it does not imply a model was tested.
