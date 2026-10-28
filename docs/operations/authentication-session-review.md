# Authentication and Session Review Guide

## Scope
Review login, session or token handling, logout, and access denial behavior in VigiLens.

## Checks
- Missing credentials are rejected.
- Invalid or expired credentials are rejected.
- A user cannot access another user's protected resources without authorization.
- Role restrictions are enforced on the server, not only hidden in the frontend.
- Logout or revocation behavior matches the application's documented session model.
- Sensitive routes do not leak information through overly detailed error messages.
- Repeated failed login attempts are handled according to the configured security policy.

## Secret hygiene
- Never include passwords, access tokens, signing keys, or session cookies in logs or issue reports.
- Use test accounts and synthetic data for validation.
- Rotate any credential that may have been exposed.

## Record
For each check, record the expected response, observed response, environment, and evidence reference. This guide is not proof that authentication has been tested or that every vulnerability is covered.
