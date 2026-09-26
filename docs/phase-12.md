# Phase 12 — Live Production Smoke Test

Live verification of the deployed VigiLens application against the production
Vercel projects. Phase 12 (2026-09-25) established the baseline and was
blocked by a missing deployment secret. **Phase 12B (2026-09-26)** attempted
to unblock it, fixed the one repository defect that was genuinely fixable, and
re-classified every workflow against live evidence.

**Final classification: PRODUCTION SMOKE TEST BLOCKED.**

The blocker is unchanged and is **not** a code defect: the `vigilens-api`
Vercel project has no `CAMERA_CREDENTIALS_KEY`, and the backend intentionally
refuses to start without it. That secret requires an operator decision and was
therefore not created, guessed, or fabricated.

## 0. Phase 12B — Unblock Attempt (2026-09-26)

### 0.1 Outcome in one line

Nothing in the repository can fix a missing production secret. The API still
returns HTTP 500 on every route for exactly the same reason as on 2026-09-25.

### 0.2 What Phase 12B changed

One genuine defect was found and fixed: the readiness gate reported a
deliberately absent AI service as `offline`, which pinned `/health/ready` to a
permanent HTTP 503 in a deployment that intentionally ships without inference.
Commit `1780661`:

| Change | File | Purpose |
|--------|------|---------|
| `config.ai.configured` | `backend/src/config/index.ts` | True only when `AI_SERVICE_URL` is actually declared |
| Skip the AI probe when undeclared | `backend/src/services/health.service.ts` | Report `not_configured` (already excluded from the readiness aggregate by `overallStatus`) instead of probing the localhost fallback and reporting a false `offline` |
| 7 new unit tests | `backend/tests/ai-service-configuration.vitest.test.ts` | Declared / undeclared / blank `AI_SERVICE_URL`, plus readiness-aggregate behaviour |
| Required-variable table | `docs/deployment.md` | Exact `vigilens-api` production variables, CORS replace-vs-extend semantics, AI serverless warning |
| Deployment limits | `docs/limitations.md` | States plainly that a Vercel deployment has no inference service |

Nothing else was touched. CORS logic, authentication, RBAC, tenant isolation,
team isolation, and camera-credential encryption are byte-for-byte unchanged.
The database schema was not modified and no data was reset.

### 0.3 Proof the readiness fix works

Run with no `.env` present, which is exactly the Vercel condition:

```
OVERALL=healthy
postgres  healthy     vigilens
prisma    healthy
ai        not_configured  AI_SERVICE_URL is not set; live inference is not available in this deployment
storage   healthy     /data/vigilens (194 GB free of 680 GB)
redis     not_configured
```

Before the change the same run reported `ai: offline` / `OVERALL=unhealthy`
(HTTP 503) purely because `http://localhost:8000` cannot resolve in a
serverless runtime.

### 0.4 Environment audit (variable names only, no values read)

`vercel env ls` against `kowshik6/vigilens-api`:

| Variable | Present | Consequence |
|----------|---------|-------------|
| `DATABASE_URL` | Yes | Used by Prisma migrations and the API |
| `INTERNAL_API_KEY` | Yes | Used for machine-to-machine calls |
| `JWT_SECRET` | Yes | Used to sign session tokens |
| `CAMERA_CREDENTIALS_KEY` | **No** | **Startup guard exits; every API request is HTTP 500** |
| `CORS_ORIGIN` | No | Not a blocker — the committed fallback already contains the live frontend origin |
| `AI_SERVICE_URL` | No | Correct for this topology; see 0.5 |

### 0.5 AI service architecture determination

**Category E — not deployed at all.** `vercel project ls` for the owning scope
returns only `vigilens`, `vigilens-api`, and unrelated projects. There is no AI
project, no AI hostname, and `vercel domains ls` reports zero custom domains.
No reachable AI service exists, so no `AI_SERVICE_URL` value was set and
`http://localhost:8000` was explicitly **not** used. Live AI inference is
recorded as NOT AVAILABLE and cannot be production-certified.

The Vercel topology is a control-plane API without inference. The Docker
Compose topology is the deployment that includes it.

### 0.6 Operator action still required

Exactly one thing unblocks the API. Run it in the `backend/` directory of a
clone linked to the `vigilens-api` project:

```bash
# 1. Generate the key. Do not echo it, do not paste it into Git.
openssl rand -hex 32

# 2. Store it (the CLI reads the value from stdin, so it stays out of shell
#    history and out of the repository).
printf '%s' '<the generated key>' | vercel env add CAMERA_CREDENTIALS_KEY production --sensitive

# 3. Make the production origin explicit (optional but recommended; this
#    REPLACES the built-in allow-list, so it must name the frontend origin).
vercel env add CORS_ORIGIN production <<< 'https://vigilens-rho.vercel.app'

# 4. Redeploy.
vercel --prod
```

Or set both in the Vercel dashboard under
**vigilens-api → Settings → Environment Variables**, then redeploy.

`CAMERA_CREDENTIALS_KEY` must be 32 bytes as 64 hex characters (or base64), must
be identical across every function invocation, must never be committed, and
must never be placed in a `VITE_*` variable. Rotating it later requires keeping
the previous value in `CAMERA_CREDENTIALS_KEY_LEGACY` so already-encrypted
camera credentials stay decryptable.

Safety note: a fresh key is safe here. The startup guard has prevented the
function from ever serving a request in this deployment, so the application
never wrote an encrypted camera credential to the production database, and
there is no prior ciphertext that a new key could orphan.

### 0.7 Phase 12B regression validation

Backend commands ran with `NODE_ENV=test` because the committed local
`backend/.env` sets `NODE_ENV=production` and the guard intentionally fails in
that mode. All database-backed suites used the local PostgreSQL instance; the
production database was never touched.

| Layer | Command | Result |
|-------|---------|--------|
| Backend build | `npm run build` | Clean |
| Backend lint | `npm run lint` | Clean |
| Backend typecheck | `npm run typecheck` | Clean |
| Backend unit suite | `npm run test:unit` | 44 files, 439 passed (was 43/432; +7 new) |
| Backend integration/API chain | `NODE_ENV=test npm test` | Build + all 46 tsx suites green, 0 failed |
| Frontend typecheck | `npm run typecheck` | Clean |
| Frontend lint | `npm run lint` | Clean |
| Frontend build | `npm run build` | Clean |
| Frontend `npm test` | `npm test` | **Fails: "Missing script: test"** (known limitation D-05) |
| Frontend E2E | `NODE_ENV=test npm run test:e2e` | 17 passed, 0 failed (local services + local DB only) |
| AI service tests | `python -m pytest` | 93 passed |
| AI service lint | `ruff check .` | Clean |

### 0.8 Commit and deployment state

| Item | Value |
|------|-------|
| Phase-12B commit | `1780661` — `fix: unblock production deployment configuration` |
| `HEAD` | `1780661dfc3e667d7a63e0dfd407ef0592d4a3fa` |
| `origin/main` | `1780661dfc3e667d7a63e0dfd407ef0592d4a3fa` |
| `git status --porcelain` | empty (clean) |
| Push | `3981dac..1780661 main -> main`, fast-forward, no force push |
| Frontend deployment | `vigilens-1hz0vpzsj-kowshik6.vercel.app` (`dpl_BbsQoupT1n4XbVPRgiJCamTnAmAw`), Ready |
| Backend deployment | `vigilens-mpgq4nnub-kowshik6.vercel.app` (`dpl_7aapL25HdmYJdbqyoCBThPfXvqzd`), Ready |

Deployment status alone was not treated as success; section 0.9 re-probed the
live canonical hosts.

### 0.9 Live production re-probe after the Phase 12B deploy

| Request | Result |
|---------|--------|
| `GET https://vigilens-rho.vercel.app/` | 200 |
| `GET https://vigilens-rho.vercel.app/api/health` | 500 |
| `GET https://vigilens-rho.vercel.app/api/health/ready` | 500 |
| `GET https://vigilens-api.vercel.app/health` | 500 |
| `GET https://vigilens-api.vercel.app/health/live` | 500 |
| `GET https://vigilens-api.vercel.app/health/ready` | 500 |
| `OPTIONS https://vigilens-api.vercel.app/api/auth/me` (allowed + disallowed origins) | 500, 500 |

The 500 body is Vercel's `FUNCTION_INVOCATION_FAILED` placeholder, not an
application JSON error — the function process exits during module import
before Express handles the request, which is exactly the fail-closed posture
described in `docs/limitations.md`.

## 0.10 Phase 12B smoke-test results (17 checks)

Evidence was gathered with headless Chrome over CDP against the canonical
production host, plus direct HTTP probes. A login attempt used a freshly
generated, guaranteed-invalid synthetic address purely to reach the deployed
endpoint; it created no account and mutated no data.

| # | Check | Classification | Evidence |
|---|-------|----------------|----------|
| 1 | Frontend | **PASS** | All 17 routes returned 200 with a populated `#root`; protected routes correctly redirect to `/login` |
| 2 | Login | **BLOCKED** | `POST /api/auth/login` → 500 `FUNCTION_INVOCATION_FAILED` |
| 3 | Logout | **BLOCKED** | Requires a session; none can be issued |
| 4 | Protected routes | **PASS (client-side only)** | Route guard redirects every protected path to `/login`; server-side enforcement unverified |
| 5 | RBAC | **BLOCKED** | Needs a production session and the four roles |
| 6 | Organization isolation | **BLOCKED** | Needs two production organizations |
| 7 | Team isolation | **BLOCKED** | Needs production team membership |
| 8 | Cameras | **BLOCKED** | `GET /api/cameras` → 500 |
| 9 | Detectors | **BLOCKED** | `GET /api/detectors` → 500 |
| 10 | Detections | **BLOCKED** | `GET /api/detections` → 500 |
| 11 | Alerts | **BLOCKED** | `GET /api/alerts` → 500 |
| 12 | Incidents | **BLOCKED** | `GET /api/incidents` → 500 |
| 13 | Reports | **BLOCKED** | `GET /api/reports` → 500 |
| 14 | Audit / security | **BLOCKED** | `/api/audit-logs`, `/api/security/dashboard`, `/api/settings` → 500 |
| 15 | Realtime | **BLOCKED** | SSE `/events` cannot connect while the API 500s |
| 16 | AI service | **NOT AVAILABLE** | No AI deployment exists in the Vercel scope; no URL was fabricated |
| 17 | Browser console / network | **PASS (frontend)** | Zero uncaught exceptions and zero console errors across all 17 routes; the only network errors are the expected 500s from the blocked API |

`PASS` is claimed only where live evidence exists. No check is marked `PASS` on
the basis of a local test run or a Vercel "Ready" badge.

## 0.11 Security findings raised, not acted on

- The `vigilens` (frontend) Vercel project also stores `DATABASE_URL`,
  `INTERNAL_API_KEY`, and `JWT_SECRET` as production secrets. Vite only inlines
  `VITE_`-prefixed variables, so these are not shipped to browsers, but they
  are unnecessary exposure in a static-SPA build project. Reported for an
  operator decision; not modified, because removing variables from a live
  project is outside the scope of this phase.
- Unrelated Vercel projects named `frontend` and `backend` exist in the same
  scope alongside `vigilens` / `vigilens-api`. They are not part of the
  documented topology and were not touched.

---

# Phase 12 — Original Run (2026-09-25)

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

**BLOCKED / NOT AVAILABLE.** The AI service itself is healthy locally (93
passing tests), but production inference is not reachable. Phase 12B
established that no AI service is deployed at all in the Vercel topology
(section 0.5), so live AI inference is NOT AVAILABLE and cannot be
production-certified. `AI_SERVICE_URL` was deliberately left unset rather than
pointed at `http://localhost:8000`, and the backend now reports the service as
`not_configured` instead of a false `offline`.

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
| D-07 | An undeclared AI service was reported `offline`, pinning `/health/ready` to a permanent 503 in an inference-free deployment | Medium | FIXED AND VERIFIED (Phase 12B, `1780661`) | `config.ai.configured`; `checkAI` reports `not_configured` and skips the probe |

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

Phase 12B re-confirmed every item below on 2026-09-26 (see section 0.4 and
0.6). The list is unchanged, and item 3 is now correctly understood as "no AI
service exists in this topology" rather than a misconfiguration.

To unblock the production smoke test, an operator must:

1. Generate a strong 32-byte `CAMERA_CREDENTIALS_KEY` (for example,
   `openssl rand -hex 32`) and add it to the `vigilens-api` production
   environment. It must be a stable secret shared by all function invocations,
   never committed, and rotated only with `CAMERA_CREDENTIALS_KEY_LEGACY`.
   **This single item is what keeps the smoke test blocked.**
2. Add `CORS_ORIGIN=https://vigilens-rho.vercel.app` (comma-separated if more
   origins are needed) so the deployed frontend origin is explicit. Note this
   replaces the built-in allow-list rather than extending it.
3. Only if the Vercel deployment is ever expected to perform capture or
   inference: deploy an AI service, set `AI_SERVICE_URL` to it, and provision
   the matching `INTERNAL_API_KEY` there. Until then, live AI inference is NOT
   AVAILABLE and no `AI_SERVICE_URL` value should be set.
4. Redeploy `vigilens-api` and re-run the health probes.
5. Provide approved production test accounts (super admin, admin, operator,
   viewer) across at least two organizations so authentication, RBAC, and
   isolation can be verified live.

No code change can substitute for these steps without weakening the
production security guarantees or fabricating a secret. Phase 12B proved this:
every repository-side defect that could be fixed was fixed, all suites pass,
`HEAD == origin/main`, both Vercel projects deployed successfully — and the API
still returns 500 because the secret is absent.

### PRODUCTION VERIFIED (live evidence, 2026-09-26)

- Frontend availability and asset delivery across all 17 client routes.
- Client-side route protection: every protected path redirects to `/login`.
- Zero uncaught exceptions and zero console errors in a headless Chrome pass
  over every route.
- Fail-closed production posture: the API refuses to serve rather than running
  with an insecure or missing secret.

### BLOCKED / NOT AVAILABLE

- All 12 business API route groups (auth, users, cameras, detectors, detections,
  alerts, incidents, reports, audit, security, settings, monitoring) — HTTP 500.
- Login, logout, session lifecycle, MFA, RBAC, organization isolation, team
  isolation, and realtime — all require a running API and production accounts.
- **Live AI inference: NOT AVAILABLE and not production-certified.** No AI
  service is deployed in the Vercel topology. The Vercel backend is a
  control-plane API only; Docker Compose is the topology that includes
  inference.

**PRODUCTION SMOKE TEST BLOCKED**
