# Camera Network Access Review

## Purpose
Review network exposure for camera sources connected to a VigiLens deployment.

## Inventory
- Record each approved camera identifier, source type, and responsible owner.
- Identify the hosts and services that need to reach each source.
- Document required ports and protocols from the camera or vendor configuration.
- Keep source credentials in the approved secret store, not in this inventory.

## Access review
- Restrict camera access to required hosts and network segments.
- Avoid exposing camera management interfaces directly to the public internet.
- Review firewall and routing rules for unnecessary access.
- Confirm default or unused camera accounts are disabled or changed according to policy.
- Review access after camera replacement, network changes, or staff changes.

## Validation
- Test connectivity from the intended VigiLens host.
- Confirm unrelated hosts cannot reach restricted camera interfaces where network controls are expected.
- Verify that stream credentials are not present in logs or committed configuration.

## Record
Capture the date, scope, findings, exceptions, and remediation owner. Validate against the actual deployment; this checklist does not prove network isolation.
