# Environment Parity Review Checklist

## Goal
Identify configuration differences that could cause VigiLens to behave differently across development, staging, and production.

## Compare
- Application and service versions.
- Database engine/version and migration state.
- Required environment variable names and validation rules.
- Camera source types and non-secret connection settings.
- AI model identifiers and inference configuration.
- Network routes, exposed ports, and allowed origins.
- Resource limits, health checks, and storage configuration.
- Notification integration mode and test/production destinations.

## Secret handling
Compare whether required secrets are present without copying or displaying their values. Never commit real credentials or include them in review output.

## Review process
Document intentional differences and investigate unexplained ones. Validate changes in a lower environment before production where practical.

## Record
Capture environment, compared revision, differences, risk, owner, and resolution. Do not claim environments are equivalent merely because they use the same source revision.
