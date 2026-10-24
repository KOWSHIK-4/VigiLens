# Configuration Change Review Checklist

Use this checklist when changing VigiLens environment variables, detector settings, camera sources, or deployment configuration.

## Before the change
- State the reason for the change and expected behavior.
- Identify the affected services and environments.
- Confirm a rollback value or recovery procedure is available.
- Check whether the change affects authentication, permissions, retention, network exposure, or detection thresholds.

## Secret handling
- Store secrets in the approved secret mechanism or local environment file excluded from version control.
- Update example files with placeholder values only.
- Rotate any credential that was accidentally committed or exposed; removing it from a later commit is not sufficient.

## Validation
- Validate required variables and expected formats before starting services.
- Check detector thresholds against documented defaults and the intended deployment.
- Review port bindings and allowed origins to avoid unintended public exposure.
- Apply the change in a non-production environment when available.

## After the change
- Confirm affected services start and health checks pass.
- Verify a representative camera/inference path and API behavior.
- Inspect sanitized logs for configuration errors.
- Document the actual result, rollback outcome if used, and any follow-up work.
