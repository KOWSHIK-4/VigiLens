# Dependency Update Review Checklist

## Before updating
- Identify the package, current version, target version, and reason for the update.
- Review release notes and security advisories relevant to the change.
- Check runtime, framework, and platform compatibility.
- Confirm the lockfile is updated consistently with the package manifest.

## Verification
- Run the project's available unit and integration tests.
- Build the affected service or frontend.
- Run static analysis or type checks when configured.
- Exercise the affected API, camera, inference, or UI path in a safe test environment.
- Review startup logs and dependency warnings.
- Inspect the diff for unexpected lockfile churn or unrelated changes.

## Security
- Prefer maintained versions from trusted package sources.
- Avoid committing tokens or private registry credentials.
- Document any temporary exception and its removal plan.

## Merge readiness
- Summarize the change and verification actually performed.
- Link relevant test output or issue reports.
- Do not mark checks as passed if they were skipped or failed.
- Keep a rollback path for updates that affect production behavior.
