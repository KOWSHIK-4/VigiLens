# VigiLens Incident Response Checklist

## 1. Identify
- Record the start time, affected environment, service, and visible symptoms.
- Determine whether the impact is limited to one camera or affects multiple components.
- Preserve relevant logs before restarting services, where practical.

## 2. Contain
- Limit access to affected credentials or endpoints if compromise is suspected.
- Avoid sharing raw event images or personal data beyond the authorized response team.
- Do not disable authentication or security controls as a quick workaround.

## 3. Diagnose
- Check service health, database connectivity, recent deployments, and configuration changes.
- Compare application timestamps with camera frame timestamps.
- Separate confirmed facts from hypotheses in the incident record.

## 4. Recover
- Apply the smallest safe corrective action.
- Verify API health, fresh-frame processing, and expected alert delivery.
- If a rollback is required, use the deployment's documented rollback procedure.

## 5. Learn
- Record the root cause when known, customer or operational impact, and recovery time.
- Create follow-up tasks for prevention, detection, and documentation gaps.
- Review whether the response exposed secrets or retained data longer than intended.
