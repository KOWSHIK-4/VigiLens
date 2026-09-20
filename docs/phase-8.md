# Phase 8 — Security Intelligence and Production Certification

Final phase report. Phase 8 added the security intelligence layer —
threat intelligence, cross-camera and fleet event correlation, explainable
risk scoring, camera fleet health, measured AI telemetry, scoped global
search, webhook retry automation and scheduled reporting — then closed with
a full-stack regression certification of every layer.

## Scope

| Area | Deliverable |
|------|-------------|
| Security intelligence | Threat-intelligence report over real stored signals (typed, levelled `low`/`medium`/`high`, every finding traceable to its source rows) plus a drill-down context endpoint |
| Event correlation | Correlation groups shared across cameras and the fleet, with `sequenceId`s that bridge camera boundaries |
| Risk scoring | Deterministic, explainable 0–100 risk score per detection (weighted `factors` + a human-readable `summary`) |
| Realtime hardening | Bounded client-side retry + connection status policy for the SSE streams |
| AI telemetry | Measured inference metrics with an honest status (`ok`/`degraded`/`unavailable`/`not_configured`); unmeasured fields are `null`, never fabricated |
| Camera fleet health | Per-camera reliability (health-check ratios, failure gaps, last status) + a fleet verdict (`healthy`/`degraded`/`at_risk`) |
| Webhook automation | Bounded exponential-backoff retry (max 5 attempts, jitter, 30-minute delay cap, `X-VigiLens-Delivery` header), idempotent against re-deliveries |
| Global search | Scoped search across detections, alerts, incidents, cameras, audit and users; gated on `monitoring.read`, sections trimmed to the caller's own grants |
| Scheduled reporting | Settings-driven daily / weekly / monthly in-process scheduler; idempotent, no report on first boot, overlap-guarded |
| Accessibility & consistency | Consistent dialogs, navigation and keyboard/ARIA behavior across the frontend |

No permission changes were introduced in Phase 8; the seeded permission catalog
("36 permissions across 13 categories") is unchanged, and the new read gates
reuse existing keys (`monitoring.read`, `detections.read`, `security.read`,
`audit.read`).

## Commits

| Commit | Message |
|--------|---------|
| `73817b0` | feat: add security intelligence and threat correlation |
| `33e4572` | feat: extend event correlation across cameras and fleets |
| `44f84b6` | feat: add explainable security risk scoring |
| `10a3195` | feat: harden realtime connections with bounded retry and status |
| `4faa8b8` | feat: add measured ai telemetry without fabricated metrics |
| `c60904b` | feat: surface camera fleet health and reliability |
| `0016e3a` | feat: add webhook retry automation with idempotent deliveries |
| `802537d` | feat: add scoped global search across security entities |
| `e581cd7` | feat: add scheduled security reporting |
| `8d6f5e4` | feat: complete accessibility and interface consistency |
| (this commit) | regression validation + final Phase 8 report |

## Regression validation

Full-stack certification after the final accessibility pass (commit `8d6f5e4`):

| Layer | Command | Result |
|-------|---------|--------|
| Backend build + integration/API suite | `npm test` (tsc build + tsx suites, DB-backed, `NODE_ENV=development`) | every suite passed, 0 failed (RBAC 50/50; camera credential redaction 10/10; final E2E production validation 32 passed) |
| Backend unit suite | `npm run test:unit` (vitest) | 42 files, 422 passed |
| Backend lint | `npm run lint` (eslint, `--max-warnings 0`) | clean |
| Backend typecheck | `npm run typecheck` (`tsc --noEmit`) | clean |
| Frontend typecheck | `npm run typecheck` | clean |
| Frontend lint | `npm run lint` | clean |
| Frontend production build | `npm run build` (tsc && vite build) | built, 0 errors |
| Frontend E2E | `npm run test:e2e` (`NODE_ENV=development`) | 17 passed |
| AI test suite | `pytest` (`ai/.venv`) | 93 passed |
| AI lint | `ruff check` | All checks passed! |

Coverage highlights held across the certification: cross-camera correlation
groups with `sequenceId` bridges, deterministic risk-score explanations, real
(not fabricated) AI telemetry with `null` for unmeasured metrics, fleet
verdicts derived from actual health logs, idempotent scheduled reports,
bounded webhook retry with a delivery header, and — after two corrections
landed in this commit — a stale RBAC expectation reconciled to the intentional
token-versioning contract, and legacy plaintext camera credentials still
migrating to the encrypted columns despite the redaction scrub.

## Certification changes in this commit

- `backend/tests/rbac.test.ts` — password-change contract: a token issued
  before a password change is now revoked (`401 "Session invalidated"`),
  matching the token-versioning behaviour added in `d04ee5c`; re-logging in
  with the new password clears `mustChangePassword` and restores access.
- `backend/src/services/camera.service.ts` — legacy credential migration now
  reads the encrypted fields via `CREDENTIAL_SELECT` alone, so the prisma
  redaction scrub (keyed on `cameraType` + `password`) no longer strips them
  before the plaintext row is migrated.
- `docs/api.md` — synchronized with implementation: session revocation
  semantics, the new Phase 8 endpoints (search, intelligence, fleet health,
  correlation, risk, model telemetry), the storage settings that drive
  scheduled reports, and the security/search sections.
- `docs/phase-8.md` — this report.

## Deployment notes

- **Docker Compose (recommended path)**: the reverse proxy already routes
  `/detect/` and `/capture/` to the `ai-service` with the internal key injected
  (`frontend/nginx.conf.template`, `docker-compose.yml`). The scheduled-report
  and webhook-retry schedulers start with the backend inside `start()` and
  stop cleanly on shutdown.
- **Vercel**: `frontend/vercel.json` rewrites `/api/*` to the backend only.
  `/detect/*` is **not** routed on Vercel — there is no deployed AI-service
  project for that path. Deploying detection capture/processing from a
  Vercel-hosted frontend requires a `/detect/` rewrite to a hosted AI service
  or a gateway that injects `X-Internal-Key`. CI does not exercise `/detect/`
  (no AI service in GitHub Actions); it is exercised by the Docker path.
- **Scheduled reports and webhook retry** run inside the backend process; CI
  validates them through their unit and integration suites rather than a
  live timer.

## Non-goals (unchanged)

- No fabricated intelligence or metrics — every signal derives from stored
  rows; unmeasured telemetry is `null`.
- No face recognition / attribute models (labels come from YOLO classes).
- No GPU-resident weights in the repository (CPU inference; GPU is a hint).
- Single-PC capture only — no distributed streaming (see `limitations.md`).

See `api.md` for the synchronized endpoint reference, and `deployment.md` for
proxy and environment configuration.