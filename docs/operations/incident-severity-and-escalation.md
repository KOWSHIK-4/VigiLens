# Incident Severity and Escalation Guide

## Purpose
Help operators classify VigiLens incidents consistently. Adapt severity definitions to the deployment's service commitments.

## Suggested classification
- **Critical:** broad service outage, suspected compromise of privileged credentials, or a serious risk to protected data.
- **High:** core detection or alerting unavailable for an important deployment, or repeated failures with significant operational impact.
- **Medium:** degraded behavior with a workaround, limited camera or feature impact, or recurring non-critical errors.
- **Low:** cosmetic issue, documentation gap, or isolated problem with minimal operational impact.

## Escalation steps
1. Record start time, affected environment, symptoms, and known impact.
2. Notify the designated owner according to the local response process.
3. Preserve relevant sanitized logs and event identifiers.
4. State what is confirmed separately from hypotheses.
5. Escalate immediately if impact grows, data integrity is uncertain, or compromise is suspected.
6. Record mitigation, recovery verification, and follow-up actions.

## Privacy and safety
Do not include passwords, tokens, or unnecessary camera imagery in incident notes. Use the deployment's approved retention and access rules.

These severity labels are a suggested starting point, not a claim that the project already has an on-call or escalation system.
