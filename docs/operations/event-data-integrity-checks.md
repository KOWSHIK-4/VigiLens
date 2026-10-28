# Event Data Integrity Verification Guide

## Goal
Confirm that detection events remain consistent as they move through VigiLens processing and storage.

## Checks
- Verify each event has the required identifier and timestamp fields.
- Confirm timestamps use the documented timezone convention.
- Check that camera/source identifiers match the originating feed.
- Verify required severity and detector metadata are present where applicable.
- Confirm retries do not unintentionally create duplicate records when deduplication is supported.
- Check that a failed persistence operation is visible and does not appear as a successful save.
- Confirm event updates preserve relevant audit history where the application supports it.

## Test approach
Use synthetic or authorized test events in a non-production environment. Exercise normal processing, malformed input, repeated delivery, and database failure cases.

## Reporting
Record expected versus observed behavior and link any defects. Avoid using real personal data in test fixtures. Do not state that integrity is guaranteed based only on this checklist.
