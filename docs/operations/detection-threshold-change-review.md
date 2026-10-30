# Detection Threshold Change Review

## Goal
Make detector threshold changes deliberate, reviewable, and reversible.

## Before changing a threshold
- Record the current model and configuration version.
- State the reason for the proposed change and the expected effect.
- Identify the affected detection classes and deployment environments.
- Select an approved validation dataset representative of intended use.
- Define acceptance criteria before reviewing results.

## Validation
- Compare current and proposed settings on the same test inputs.
- Review false positives and false negatives, not only aggregate accuracy.
- Check class-specific behavior and difficult lighting or camera conditions where relevant.
- Measure inference latency and resource impact.
- Confirm that malformed or stale frames remain safely handled.

## Release decision
Document the observed trade-offs and obtain the required review before promotion. Keep the previous known-good configuration available for rollback.

## Evidence
Record versions, dataset description, metrics, environment, reviewer, and decision. A threshold change must not be described as validated unless the test was actually performed.
