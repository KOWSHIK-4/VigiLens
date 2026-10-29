# Authorization Matrix Review

## Goal
Review whether VigiLens roles can perform only the actions intended for them.

## Prepare
- List the roles configured in the target environment.
- List sensitive operations and resources, such as user administration, camera configuration, event review, and system settings where present.
- Define the expected allow/deny result for each role and operation.

## Verify
- Test allowed actions using a dedicated test account for each role.
- Test that restricted actions are denied by the backend, even if a UI control is manually invoked.
- Check access to resources owned by another user or outside the account's scope.
- Confirm role changes take effect according to the documented session and token behavior.
- Review audit records for security-relevant authorization changes where supported.

## Reporting
Record role, operation, expected result, observed result, and evidence reference. Do not include real passwords or tokens.

A matrix is a test plan, not proof that current permissions are correct. Validate against the deployed implementation before sign-off.
