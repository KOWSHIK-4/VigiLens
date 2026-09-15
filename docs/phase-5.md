# Phase 5 — Production Hardening and Reliability

Final phase report. Phase 5 made the VigiLens backend production-safe,
restart-tolerant, and observability-complete, then closed with a full
regression validation of the entire stack.

## Scope

| Area | Deliverable |
|------|-------------|
| Deployment & routing | Production API routing reconciled with reverse-proxy deployment (`/api` prefix, health liveness/readiness, non-exposed `X-Powered-By`, standardized 404/`requestId`) |
| AI service boundary | Standardized internal authentication configuration (`X-Internal-Key`, JWT options); boundary hardened against injection/relay |
| API documentation | Synchronized with actual implemented behavior (auth, password reset, internal ingestion, RBAC, monitoring) |
| Camera reliability | Stream health probing, frame snapshot capture, failure/recovery reporting, credential encryption at rest with redaction |
| AI restart robustness | Monitor loop + detector lifecycle recover cleanly from service restarts; honest `unavailable`/error states, no fabricated detections |
| Security operations | Security dashboard (locked accounts, failed logins, at-risk accounts), audit-aware role & user management, password policy, HTTPS enforcement |
| Incident workflow | Incident lifecycle (new → investigating → resolved/reopened), notes, assignment, activity timeline, CSV export, SSE + webhook events |
| Data-flow efficiency | Monitor status loop caching (2.5 s TTL), gzip compression (SSE excluded), narrowed camera selects (`id/name/location`), SSE-driven alert toasts/badge replacing 5 s polling |

No permission changes were introduced in Phase 5; the seeded permission catalog
("36 permissions across 13 categories") is unchanged.

## Commits

| Commit | Message |
|--------|---------|
| `99bdcaf` | fix: reconcile production API routing and deployment configuration |
| `90736ec` | fix: standardize AI service authentication configuration |
| `9025544` | docs: synchronize API documentation with implementation |
| `c76ce40` | feat: improve camera stream reliability and recovery |
| `af69ff2` | feat: make AI detection robust to service restarts |
| `6090f9c` | feat: add security operations dashboard |
| `e8ac794` | add incident investigation workflow |
| `c363028` | optimize data flows |
| (this commit) | regression validation + final Phase 5 report |

## Regression validation

Full-stack validation after the final data-flow changes (commit `c363028`):

| Layer | Command | Result |
|-------|---------|--------|
| Backend build + API/integration suite | `npm test` (tsc build + 40 tsx suites, DB-backed) | 713 passed, 0 failed |
| Backend unit suite | `npx vitest run` | 28 files, 283 passed |
| Backend lint | `npm run lint` (eslint, `--max-warnings 0`) | clean |
| Backend typecheck | `npm run typecheck` (`tsc --noEmit`) | clean |
| Frontend typecheck | `npm run typecheck` | clean |
| Frontend lint | `npm run lint` | clean |
| Frontend production build | `npm run build` (tsc -b && vite build) | built, 0 errors |
| AI test suite | `pytest` | 93 passed |
| AI lint | `ruff check` | clean |

Coverage highlights held across the regression: real YOLO inference for `person`
and `vehicle` detectors, honest `unavailable`/`error` lifecycle states for
unreachable AI, camera credential encryption + end-to-end redaction (nested
rows included), RBAC denial for every restricted surface, SSE ticket guard,
webhook HMAC signing, CSV formula-injection neutralisation, and the
`302 *`-style security header set.

## Non-goals (unchanged)

- No face recognition / attribute models (labels come from YOLO classes).
- No GPU-resident weights in the repository (CPU inference; GPU is a hint).
- Single-PC capture only — no distributed streaming (see `limitations.md`).

See `implementation-status.md` for the capability rubric, and `deployment.md`
for reverse-proxy and environment configuration.