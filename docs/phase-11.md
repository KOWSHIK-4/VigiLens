# Phase 11 — Final Security Certification

Phase-11 certification report. An independent security review
(`VigiLens_SECURITY_CERTIFICATION_2026-09-25.md`) surfaced four priority-one
findings; this phase remediates all four, tightens the team-scoped read-model
surface to match the server-side visibility contract, hardens the deployment
shape, and re-certifies the full regression chain end to end.

## Findings remediated in this phase

| Finding | Remediation |
|---------|-------------|
| Seeded `admin123` credentials and auto-seeding on deploy | `backend/vercel.json` no longer runs the seed on install; `backend/prisma/seed.ts` re-seed is a **no-op for every destructive/repointing step** unless the database is empty (`existingUserCount === 0`), so an accidental re-seed can never reactivate demo users, repoint demo cameras, force-reset model state, or delete custom models |
| Public `/detect/*` nginx proxy for internal AI endpoints | Nginx now pins `X-Forwarded-For` to `$remote_addr` for both `/api/` and `/detect/`, dropping any client-supplied value; the forwarded client IP provenance can no longer be spoofed from outside the proxy |
| Tenant admin edits global security settings | Security settings are **instance-wide**: `PATCH /settings/security` and `POST /settings/security/reset` now return `403` unless the actor is `super_admin` (`settings.controller.ts` `assertInstanceSettingsWrite`) |
| Backend publishes `:4000` and trusts proxy headers blindly | `docker-compose.yml` changed from `ports: 4000:4000` to `expose: ["4000"]` so the backend is only reachable through the reverse proxy; combined with the pin above, trusted-proxy guarantees are restored |

## Additional hardening in this phase

- **Instance-wide role integrity** (`role.service.ts`): creating a role with a
  reserved system name returns `400`; updating or editing permissions of a
  **global** (system) role requires `super_admin`; the permission cache is
  invalidated correctly when an org-scoped user resolves to a global role
  (fixes the `viewer`-only invalidation bug that left stale grants).
- **Privilege escalation guard** (`user.service.ts` `assertMayControlRole`):
  account-control operations may never escalate, demote, or interfere with an
  actor of the same or higher authority (e.g. a tenant admin cannot change a
  `super_admin`).
- **Audit-tamper verification** (`auditLog.service.ts` `verifyIntegrity` +
  `security.controller.ts`): integrity checks are scoped to the caller's
  organization; only `super_admin` can verify the full chain.
- **Org-scoped monitoring** (`engine/monitor.ts`, `monitor.controller.ts`):
  runtime status is load-balanced per organization and camera credentials are
  redacted from the status payload; the worker pool is capped at 4 concurrent
  runs and per-camera loops are cached, eliminating a status storm.
- **Realtime alerting boundary** (`realtime.routes.ts`): the SSE `/events`
  stream requires `alerts.read`, and when a caller without `teams.read` does
  not specify team ids the stream defaults to their own team scope.
- **Team-scoped read model** — cameras, alerts, incidents, detections, fleet
  health, detection risk context, and fleet correlation now honor the same
  `organizationId` + `teamScopeId` filter applied across by-id routes (via
  `enforceTeamVisibility`), on every mutation and read path, including camera
  start/stop/capture/thumbnail/health-logs, incident status/priority/assign/
  notes, and detection risk/correlation endpoints.
- **Incident list performance** (`incident.service.ts`): the list path uses a
  trimmed include (notes/activity limited to the latest 5) while by-id keeps
  the full engagement trail; the incident summary endpoint is team-scoped.

## Known limitation (accepted)

The ONNX/YOLO detector catalogue (`AIModel`, detector settings, camera-to-
detector associations) remains instance-wide by design: a tenant can enable or
disable models but cannot upload or fork model weights per tenant. Per-tenant
model forking is tracked as future work; the shared catalogue never bypasses
the authn/authz boundary itself.

## Regression validation

Run with `NODE_ENV=test` (the committed `backend/.env` sets
`NODE_ENV=production` for local tooling; the test runner uses a dedicated
PostgreSQL database while suites spin the backend on isolated ports).

| Layer | Command | Result |
|-------|---------|--------|
| Backend build + integration/API chain | `npm test` (tsc build + 46 tsx suites) | every suite green (`0 failed`) |
| Backend unit suite | `npx vitest run` | 43 files, 432 passed |
| Backend lint | `npx eslint src --ext .ts --max-warnings 0` | clean |
| Backend typecheck | `npx tsc --noEmit` | clean |
| Frontend typecheck + build | `npm run typecheck` / `npm run build` | clean |
| AI service tests | `python -m pytest` (ai) | 93 passed |
| AI service lint | `ruff check .` (ai) | clean |

Coverage highlights on the final chain: security settings are refused to
non-super admins (`403`) and accepted by super admins; MFA enforcement can
only be toggled after the super admin completes the enforced-enrollment flow;
rate-limit tuning applies instance-wide immediately; realtime members without
`teams.read` subscribe only to their own team and non-members are rejected;
members without `alerts.read` cannot open the alert stream; incident/detection
/camera by-id operations remain routed through the team scope; audit integrity
verification is org-scoped; camera capture marks failures and records health
logs end to end.

## Commits

| Commit | Message |
|--------|---------|
| `6c5b11e` | security: harden instance-wide authorization and org-scoped monitoring |
| `80d9975` | security: enforce team-scoped visibility across alerts, cameras, detections, and incidents |
| `0954fda` | security: remove seed from deploy, close published ports, pin proxy client IP |
| `c187771` | test: align suites with instance-wide settings boundary and realtime alert gate |
| (this commit) | docs: complete Phase 11 production certification and file the security review |

## Deployment notes

- **No migration ships with this phase.** All changes are authorization,
  configuration, and seed-safety oriented.
- **Seed safely**: a deploy runs `npm ci && prisma migrate deploy` only; the
  initial database (or a fresh environment) is provisioned by an operator who
  runs the seed explicitly against an empty database. Re-running the seed on a
  populated database is a no-op for every destructive step.
- **Topology**: nginx (frontend) terminates TLS and proxies `/api/` and
  `/detect/` using the real TCP peer (client) IP for `X-Forwarded-For`; the
  backend container is exposed only on the compose network, never on a host
  port.
- **Security settings**: `security` settings are super-admin-owned; tenant
  admins continue to own org-scoped operational (notification/webhook)
  settings.

See `api.md` for the synchronized endpoint reference and `deployment.md` for
proxy and environment configuration.

PRODUCTION CERTIFICATION COMPLETE