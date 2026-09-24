# Phase 10 — Production Hardening & Certification

Final phase report. Phase 10 took the platform from feature-complete to
production-certified: it closed cross-tenant data-isolation holes, prevented
privilege escalation through role assignment, isolated realtime subscriptions
(and scoped the subscriber registry per organization), enforced server-side
team visibility, added composite indexes for tenant-scoped hot paths, scoped
system settings and webhook configuration per organization, introduced
organization-scoped roles, repaired scheduled reporting under PgBouncer-style
failure modes, and added TOTP multi-factor authentication with a corrected
session-inactivity policy — closing with a regression test sweep and full
end-to-end CI wiring.

## Scope

| Area | Deliverable |
|------|-------------|
| Tenant isolation | Cross-tenant holes closed in report downloads, camera snapshots and engine processing (no live cross-tenant reads/writes, fail closed with `404`) |
| RBAC escalation guard | Role assignment and password reset can never mint or grant authority the actor does not possess (assignment, reset and lock paths verified for super-admin protection) |
| Realtime isolation | Subscriber `organizationId` on every SSE connection; event fan-out skips foreign tenants (`23d75e4`); `GET /realtime/subscribers` snapshot **and** count scoped to the caller's organization |
| Team visibility | Server-enforced team scope for cameras/detections/alerts/analytics/audit for members without `teams.read`; cross-tenant team operations fail closed (`404`/`403`) |
| Tenant hot-path indexes | `team_id`/`organization_id` composite indexes on the tenant-scoped read surfaces |
| Org-scoped settings & webhooks | Operational settings (notifications incl. webhook config) stored per organization; `security` remains instance-scoped |
| Org-scoped roles | Custom roles carry an `organizationId`; `resolveRole` prefers the tenant's own role then the instance-wide fallback; cross-tenant role names fail closed |
| Reporting repair | Scheduled report/export generation bounded (size/date caps) and repaired under outage modes |
| MFA & sessions | TOTP enrollment/verify/disable, 10 single-use recovery codes, `MFA_REQUIRED` login prompt, org-wide `mfa_enforced` gates the un-enrolled, per-session rows with a *sliding* inactivity window |
| Certification | Isolation/RBAC/realtime regression suites added; full e2e (`npm test`) wired into CI alongside unit tests with a real test database |

## Commits

| Commit | Message |
|--------|---------|
| `97f7fc0` | fix: close cross-tenant holes in report downloads, snapshots, and engine processing |
| `0abd63f` | security: prevent privilege escalation through role assignment and password reset |
| `23d75e4` | security: isolate realtime subscriptions and authorize team channels |
| `cff9013` | feat: enforce server-side team visibility and tighten team-lead scope |
| `bcb9d0d` | feat: add team columns and composite indexes for tenant-scoped hot paths |
| `7a454e1` | feat: scope system settings and webhook configuration per organization |
| `1cce1ce` | feat: introduce organization-scoped roles and align the permission contract |
| `0f50a89` | fix: repair scheduled reporting and bound report/export generation |
| `b7df306` | feat: add TOTP multi-factor authentication and correct session inactivity policy |
| `3c112fb` | test: close tenant, RBAC, and realtime regression gaps and wire e2e into CI |
| (this commit) | docs: complete Phase 10 production certification and synchronize security documentation |

## Regression validation

Full-stack certification on the final state (HEAD `3c112fb` + this docs commit):

| Layer | Command | Result |
|-------|---------|--------|
| Backend build + integration/API suite | `npm test` (tsc build + 46 tsx suites, DB-backed) | every suite passed, 0 failed |
| Backend tenant isolation suite | `npx tsx tests/tenant-isolation.test.ts` | 45/45 passed |
| Backend isolation regressions | `npx tsx tests/isolation-regressions.test.ts` | 23/23 passed (realtime fan-out, subscriber registry scope, org settings, RBAC cross-tenant guards) |
| Backend realtime suite | `npx tsx tests/realtime.test.ts` | 30/30 passed |
| Backend MFA/session suite | `npx tsx tests/mfa.test.ts` | 31/31 passed |
| Backend RBAC suite | `npx tsx tests/rbac.test.ts` | 69/69 passed |
| Backend unit suite | `npx vitest run` | 43 files, 432 passed |
| Backend lint | `npx eslint src --ext .ts --max-warnings 0` | clean |
| Backend typecheck | `npx tsc --noEmit` | clean |
| CI backend job | GitHub Actions (migrate → seed → lint → typecheck → build → vitest → `npm test` on PostgreSQL 16) | all steps pass |

Coverage highlights: org-B alerts never reach org-A SSE subscribers; an
org-B admin sees zero org-A subscribers (list and count); tenant settings
writes stay within the tenant; assigning a foreign tenant's role name fails
closed (`400`); cross-tenant user operations return `404` in both directions;
viewers are denied the role catalogue (`403`); MFA enrollment, TOTP login,
recovery-code consumption, `mfa_enforced` gating and the sliding inactivity
window are all proven end to end.

## Certification changes in this commit

- `docs/phase-10.md` — this report.
- `docs/api.md` — MFA endpoints and login challenge documented under
  Authentication; the `mfa_enforced` / `allow_registration` security settings
  and `webhook_enabled`/`webhook_url`/`webhook_secret` notification settings
  listed; operational settings noted as organization-scoped; the realtime
  subscriber snapshot documented as organization-scoped (list and count).
- `docs/roles-and-permissions.md` — account-level security controls (MFA,
  session inactivity, enforcement gating) noted as layered *on top of*
  permission checks without new permission keys.
- `docs/implementation-status.md` — MFA & session policy row and CI
  certification note.

## Deployment notes

- **Migration**: one additive migration ships with this phase
  (`20260924230000_add_mfa_and_user_sessions`) adding `User.mfaSecret` /
  `mfaEnabled` / `mfaRecoveryCodes` and the `UserSession` model (`sid` claim,
  cascading delete, indexed by session id). Columns are nullable and new
  tables are empty at deploy time, so no backfill is required.
- **MFA**: enabled per account via the API (`POST /auth/mfa/setup` then
  `/mfa/verify`). `mfa_enforced` (under `security`) turns on org-wide
  enforcement: un-enrolled accounts can only reach the enrollment flow, their
  own profile and logout until they enroll. Recovery codes are single-use.
- **Sessions**: logins now open a `UserSession`; the JWT carries a `sid` claim
  and `session_timeout_minutes` is enforced as a *sliding inactivity* window
  (activity refreshes `lastActivityAt`). Tokens issued without a session fall
  back to the JWT `exp` as the hard cap.
- **Subscriber registry**: `GET /realtime/subscribers` now reports only the
  caller's own organization (and its count), removing a cross-tenant
  enumeration vector while keeping the `teams.read` distinction within the
  tenant.
- **CI**: the backend job runs `prisma migrate deploy` and seed against
  `vigilens_test`, then lint/typecheck/build, and both `npx vitest run` and
  the full `npm run test` e2e suite with `DATABASE_URL` set — so every
  commit is certified against a real PostgreSQL instance.

## Non-goals

- MFA recovery codes are single-use and have no replacement workflow.
- `mfa_enforced` is a single org-wide switch (per-role or per-tenant MFA is
  not attempted).
- Roles remain additive: an organization-scoped role shadows the
  instance-wide fallback only within its owning organization.
- The audience-scoped subscriber snapshot still surfaces the `teams.read`
  holder's full tenant view; it never crosses organizations.

See `api.md` for the synchronized endpoint reference, and `deployment.md`
for proxy and environment configuration.