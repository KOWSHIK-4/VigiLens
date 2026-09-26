# Phase 12 — Live Production Smoke Test

Live verification of the deployed VigiLens application on 2026-09-25 against
the production Vercel projects. This phase exercised the deployed frontend and
API, fixed every defect that could be fixed from the repository, and classified
every workflow that could not be verified.

**Final classification: PRODUCTION SMOKE TEST BLOCKED.**

## 1. Executive Summary

| Area | Classification | Result |
|------|----------------|--------|
| Frontend availability and asset delivery | PASS | SPA shell, hashed JS/CSS, and 13 client routes served without client-side errors |
| Client-side routing | FIXED AND VERIFIED | `/dashboard`, `/team`, `/audit`, and `/security` no longer render the in-app 404 |
| Production API | FAIL | Every API request returns HTTP 500 `FUNCTION_INVOCATION_FAILED` |
| Root cause | CONFIRMED | Backend startup guard fails because `CAMERA_CREDENTIALS_KEY` is not set in Vercel |
| Authenticated workflows | BLOCKED | Login, session, MFA, RBAC, and every business API require a running backend |
| Repository regressions | PASS | Backend, frontend, AI, and E2E suites pass except the missing frontend `npm test` script |
| Environment changes | NOT PERFORMED | Production variables require an operator; none were added, changed, or printed |

## 2. Scope and Safety Constraints

- Read-only verification of live routes, health endpoints, deployment metadata,
  and runtime logs; browser automation used a synthetic, freshly generated
  invalid credential to reach the deployed login endpoint, which failed with
  the same startup error as every other API route.
- No production data was created, updated, or deleted.
- No production environment variable was added, changed, or removed. Secret
  values were never printed, copied into the repository, or committed.
- No credential was guessed or escalated. No valid production test account was
  available, so no authenticated session was created.
- Git history was not rewritten: no reset, rebase, amend, force-push, or squash.
- Only two repository defects were fixed: client-side route aliases and the
  production CORS fallback origin.

## 3. Repository and Commit State

| Item | Value |
|------|-------|
| Repository | `KOWSHIK-4/VigiLens` |
| Branch | `main` |
| Phase-12 starting point | `7e0e677` (Phase 11 certification) |
| Source fix commit | `fb2b68b` — `fix: restore production route aliases and CORS fallback` |
| Documentation commit | (this commit) |
| Working tree after the phase | clean; `main` synchronized with `origin/main` |

Pre-flight confirmed a clean tree with `HEAD == origin/main` before any work
began. The only changes made in the phase are the two source fixes, this
report, and the documentation corrections listed in D-06.

## 4. Production Topology

| Component | Canonical host | Project |
|-----------|----------------|---------|
| Frontend SPA | `https://vigilens-rho.vercel.app` | `vigilens` |
| Backend API | `https://vigilens-api.vercel.app` | `vigilens-api` |

The frontend `vercel.json` rewrites `/api/:path*` to the backend origin and
falls back to `index.html` for all non-API routes, so the browser always calls
the API same-origin. The backend `vercel.json` runs `npm ci` and
`prisma migrate deploy`, then rewrites `/:path*` into the `api/index.ts`
function. It does not seed.

Source-fix production deployments (both Ready at the time of the post-fix
retest; the documentation-only commit that publishes this report triggers a
later redeploy of the same source with unchanged behavior):

- Frontend: `vigilens-dj6hva6dx-kowshik6.vercel.app`
  (`dpl_FA6kUFAGB5VmxDRK4RXVi2m695AU`), aliased to the canonical frontend host.
- Backend: `vigilens-dzgrvzk4e-kowshik6.vercel.app`
  (`dpl_4ZpCT6FDkRpy5L5pEvyakAvibmdd`), aliased to the canonical backend host.

## 5. Environment Variable Audit

Only variable **names** were inspected; values were never displayed.

| Variable | Present in Vercel | Consequence |
|----------|-------------------|-------------|
| `DATABASE_URL` | Yes | Used by Prisma migrations and the API |
| `INTERNAL_API_KEY` | Yes | Used for machine-to-machine calls |
| `JWT_SECRET` | Yes | Used to sign session tokens |
| `CAMERA_CREDENTIALS_KEY` | **No** | Startup guard fails; every API request is HTTP 500 |
| `CORS_ORIGIN` | No | Fallback allow-list now covers the live frontend origin; explicit value still recommended |
| `AI_SERVICE_URL` | No | Defaults to `http://localhost:8000`, unreachable on Vercel; capture and inference cannot work until set |

The backend fails closed by design in `NODE_ENV=production`. The missing
camera-credential key is a deployment configuration gap, not a code defect, and
cannot be fixed from the repository without fabricating a secret that would be
inconsistent across serverless invocations.

## 6. Frontend Availability

**PASS.** The following routes returned HTTP 200 with the SPA shell and loaded
their hashed JS/CSS assets:

`/login`, `/dashboard`, `/cameras`, `/detectors`, `/detections`, `/alerts`,
`/incidents`, `/reports`, `/analytics`, `/team`, `/settings`, `/audit`,
`/security`.

A headless Chrome pass over every route recorded zero uncaught exceptions, zero
console errors, zero failed network requests, zero unexpected 4xx/5xx
responses, and a non-empty `#root` on every page.

## 7. Route and Navigation Verification

**FIXED AND VERIFIED.** Before the fix, four shared/bookmarked paths rendered
the in-app 404 page because the router only defines the canonical paths. After
the fix, the router redirects the legacy paths to their canonical equivalents:

| Legacy path | Canonical target |
|-------------|------------------|
| `/dashboard` | `/` |
| `/team` | `/teams` |
| `/audit` | `/audit-logs` |
| `/security` | `/security-dashboard` |

Post-deployment browser evidence: all four legacy paths now resolve to
`/login` for an unauthenticated visitor (the same destination as the
canonical protected paths) with no console or network errors. The public
`/login` page renders its email and password fields correctly.

## 8. Authentication and Session Lifecycle

**BLOCKED.** `GET /api/auth/me` returns HTTP 500, and a synthetic invalid
login attempt also returns HTTP 500, so the deployed API cannot issue or
validate a session. Login, logout, token claims, expiry, and the
session-inactivity window were verified only in the local integration suite.

## 9. MFA

**BLOCKED.** MFA enrollment, verification, recovery codes, `mfa_enforced`
gating, and logout invalidation were verified only in the local MFA suite
because no production account or session is available.

## 10. Authorization and RBAC

**BLOCKED.** The four roles and their 36 permissions were verified by the
local `rbac` and `auth-policy` suites. Live RBAC checks require a production
session and are blocked by the startup failure.

## 11. Organization Isolation

**BLOCKED.** Cross-tenant read/write refusal was verified locally by the
tenant-isolation, isolation-regression, and API suites. It was not exercised
live because the API never starts and no production accounts were available.

## 12. Team Isolation

**BLOCKED.** Team-scoped visibility for cameras, alerts, incidents,
detections, and analytics was verified locally by the team-visibility and
isolation-regression suites but not live, for the same reason.

## 13. Camera Management

**BLOCKED.** Camera CRUD, credential encryption at rest, credential redaction,
and the live health-log lifecycle were verified locally. The production AI
`AI_SERVICE_URL` is also unset, so live capture and inference would remain
unavailable after the API is repaired until it points at a reachable service.

## 14. Detector and Model Management

**BLOCKED.** Model and detector catalog reads, activation, and the
marketplace were verified against the local seeded database and via the local
E2E harness. The production API is unavailable, so these screens cannot be
confirmed against production data.

## 15. Detection and AI Integration

**BLOCKED.** The AI service itself is healthy locally (93 passing tests), but
production inference is not reachable because the backend is down and
`AI_SERVICE_URL` is unset on Vercel.

## 16. Alerts

**BLOCKED.** Alert list, acknowledgement, and team assignment were verified
locally. CSV export of alerts returned correct rows in the local E2E harness.
The production alert API is unavailable.

## 17. Incidents

**BLOCKED.** Incident lifecycle, investigation notes, and activity timelines
were verified locally but cannot be exercised against production.

## 18. Reports, Exports, and Analytics

**BLOCKED.** Report generation, CSV export, and analytics endpoints were
verified locally. The production API is unavailable for all of them.

## 19. Realtime

**BLOCKED.** The SSE `/events` authorization (alerts and team scoping) was
verified locally. The production realtime endpoint cannot be reached while the
API returns 500.

## 20. Security and Audit Surface

**PARTIAL / BLOCKED.** The production API fails closed — it does not start
with a missing production secret, which is the intended security posture. Audit
log reads/exports, security-dashboard data, and security headers could not be
inspected on the live API because every request fails before Express handles
it. CORS behavior on the deployed API also cannot be exercised until the API
starts; the committed fallback now includes the live frontend origin as a
defensive measure.

## 21. Confirmed Defects and Remediation

| ID | Defect | Severity | Status | Fix |
|----|--------|----------|--------|-----|
| D-01 | `/dashboard`, `/team`, `/audit`, `/security` rendered the in-app 404 | Medium | FIXED AND VERIFIED | `Navigate` aliases to canonical routes in `frontend/src/App.tsx` |
| D-02 | Production API returns HTTP 500 on every route | High | OPEN (operator action) | Add `CAMERA_CREDENTIALS_KEY` in Vercel and redeploy |
| D-03 | CORS fallback did not include the live frontend origin | Low | FIXED | Added `https://vigilens-rho.vercel.app` to the default allow-list |
| D-04 | `AI_SERVICE_URL` unset on Vercel (defaults to `localhost:8000`) | Medium | OPEN (operator action) | Point it at a reachable AI service and match `INTERNAL_API_KEY` |
| D-05 | `frontend` has no `npm test` script | Low | OPEN (test tooling) | Add a frontend test runner or a `test` alias in a future phase |
| D-06 | Deployment docs listed the wrong frontend host and claimed Vercel seeds | Low | FIXED | Corrected `README.md`, `docs/deployment.md`, and `docs/limitations.md` |

## 22. Regression Validation

Backend commands were run with `NODE_ENV=test` because the committed local
`backend/.env` sets `NODE_ENV=production` and the production guard
intentionally fails in that mode. The first `npm test` invocation without the
override failed at the security-validation guard; the re-run with the override
passed the entire chain. That first failure is an environment invocation, not a
code regression.

| Layer | Command | Result |
|-------|---------|--------|
| Backend build + integration/API chain | `npm test` | Build + all 46 tsx suites green (0 failed) |
| Backend unit suite | `npm run test:unit` | 43 files, 432 passed |
| Backend lint | `npm run lint` | Clean |
| Backend typecheck | `npm run typecheck` | Clean |
| Backend build | `npm run build` | Clean |
| Frontend `npm test` | `npm test` | **Fails: "Missing script: test"** (see D-05) |
| Frontend lint | `npm run lint` | Clean |
| Frontend typecheck | `npm run typecheck` | Clean |
| Frontend build | `npm run build` | Clean (2628 modules transformed) |
| Frontend E2E | `NODE_ENV=test npm run test:e2e` | 17 passed, 0 failed (local services + local DB only) |
| AI service tests | `python -m pytest` | 93 passed |
| AI service lint | `ruff check .` | Clean |

All database-backed suites used the local PostgreSQL instance; no production
database was touched. The AI tests use mocks and a local Python environment.
The E2E harness spawns its own local backend and frontend and tears them down;
it targets `localhost` only.

## 23. Post-deployment Retest

After pushing `fb2b68b`, Vercel deployed both projects and the frontend
retest in section 7 passed against the canonical host. The API retest against
the canonical backend host reproduced the failure:

- `https://vigilens-api.vercel.app/health` → 500
- `https://vigilens-api.vercel.app/health/live` → 500
- `https://vigilens-api.vercel.app/health/ready` → 500
- `https://vigilens-api.vercel.app/api/auth/me` → 500
- `https://vigilens-rho.vercel.app/api/health` → 500
- `https://vigilens-rho.vercel.app/api/health/live` → 500
- `https://vigilens-rho.vercel.app/api/health/ready` → 500

Vercel runtime logs for the new deployment confirm the cause:

```
FATAL: [SECURITY] Insecure defaults detected in production: CAMERA_CREDENTIALS_KEY (not set or insecure).
```

The process exits with status 1 on every invocation, so Vercel returns
`FUNCTION_INVOCATION_FAILED`. The unaliased per-deployment hostname served a
Vercel placeholder HTML page for all paths (including a deliberately
non-existent path) and was not used as a health signal; the canonical alias
above is the authoritative result.

## 24. Blockers, Required Operator Action, and Final Classification

To unblock the production smoke test, an operator must:

1. Generate a strong 32-byte `CAMERA_CREDENTIALS_KEY` (for example,
   `openssl rand -hex 32`) and add it to the `vigilens-api` production
   environment. It must be a stable secret shared by all function invocations,
   never committed, and rotated only with `CAMERA_CREDENTIALS_KEY_LEGACY`.
2. Add `CORS_ORIGIN=https://vigilens-rho.vercel.app` (comma-separated if more
   origins are needed) so the deployed frontend origin is explicit.
3. If the Vercel deployment is expected to perform capture or inference, set
   `AI_SERVICE_URL` to a reachable AI service and provision the matching
   `INTERNAL_API_KEY` there.
4. Redeploy `vigilens-api` and re-run the health probes.
5. Provide approved production test accounts (super admin, admin, operator,
   viewer) across at least two organizations so authentication, RBAC, and
   isolation can be verified live.

No code change can substitute for these steps without weakening the
production security guarantees or fabricating a secret.

**PRODUCTION SMOKE TEST BLOCKED**
