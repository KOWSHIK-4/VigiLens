# Phase 9 — Teams and Resource Grouping

Final phase report. Phase 9 added first-class Teams — organisational groups
with a designated lead, memberships and invitations — then wired team
ownership through the whole platform: per-tenant team assignment, team-lead
delegation of admin duties, team-scoped alerts/incidents/cameras, realtime
SSE routing per team, team-grouped UI surfaces, and team-scoped analytics
and audit filtering, closing with a regression certification.

## Scope

| Area | Deliverable |
|------|-------------|
| Teams core | `Team` model (name, description, organization, `leadId`), memberships and invitations; migration history kept additive (`teams_and_grouping`, `team_lead`, `alert_incident_team`, `camera_team`, `camera_team_audit`) |
| Tenancy & induction | Per-tenant team assignment on signup/join (`8455560`) and "join-the-right-team" induction surfaced to the frontend (`12435dc`) |
| Team-lead delegation | `TeamLeads` relation; team leads can edit their own team, manage members/invitations and delete it — without a global `teams.manage` grant (`requireTeamLeadOrManage` middleware) |
| Team-scoped assignment | `team_id` on `Alert`/`Incident` (`ON DELETE SET NULL` + indexes); `PATCH /alerts/:id/team`, `PATCH /incidents/:id/team`, `PATCH /cameras/:id/team`; `?teamId=` filters on `GET /cameras`, `GET /alerts`, `GET /incidents`; incidents inherit their alert's team at creation; all writes audited (`alert_team_assigned`, `incident_team_assigned`, `camera_team_assigned`) |
| Realtime routing | SSE subscriber `teamIds` filter; team-scoped events carry `teamId` on the frame; non-team frames still reach everyone |
| Team-grouped UI | Teams page opens a per-team detail panel grouping that team's cameras, alerts and incidents via the `teamId` filters; `Camera.team` / `Alert.team` / `Incident.team` previews typed on the frontend |
| Analytics & audit | `teamId` query filter on every `/analytics/*` endpoint (camera-scoped metrics and detection subqueries narrowed to the team) and on `/audit-logs` + `/audit-logs/export` (rows whose `metadata.teamId` records a team assignment) |
| Invitation tokens | Server-side team invitation tokens with accept/revoke flows (`7cb5e3f`) |

No permission keys were added; team routes gate on existing keys
(`teams.read`, `teams.manage`, `alerts.manage`, `incidents.manage`,
`cameras.manage`, `audit.read`, `analytics.read`), with team-lead
authorization layered on top by the delegation middleware.

## Commits

| Commit | Message |
|--------|---------|
| `333d9c9` | feat: introduce organization tenancy and data isolation |
| `ce18efc` | test: stamp default org on report retention fixtures |
| `43e48fb` | feat: add teams and resource grouping |
| `8455560` | feat: per-tenant team assignment and join-the-right-team induction |
| `12435dc` | feat: teams read API surfaced to frontend |
| `7cb5e3f` | feat: server-side team invitation tokens |
| `30d3943` | feat: team API/admin delegation via team leads |
| `b2650ba` | feat: team-scoped alert/incident assignment (teamId + assign endpoints + filters) |
| `3694c09` | feat: realtime SSE per-team routing (teamIds filter + team-scoped events) |
| `bee7ee4` | feat: team grouping across cameras/alerts/incidents (Camera.teamId + grouped team views) |
| `a012159` | feat: team-scoped analytics filtering and audit trail (teamId on analytics/audit, camera_team_assigned action) |
| (this commit) | docs: Phase 9 report and synchronized team API reference |

## Regression validation

Full-stack certification after the analytics/audit pass (commit `a012159`):

| Layer | Command | Result |
|-------|---------|--------|
| Backend build + integration/API suite | `npm test` (tsc build + tsx suites, DB-backed) | every suite passed, 0 failed |
| Backend team suite | `npx tsx tests/teams.test.ts` | 83/83 passed (teams, delegation, scoped assignment, grouped analytics/audit) |
| Backend audit suite | `npx tsx tests/audit-api.test.ts` | 24/24 passed |
| Backend analytics suite | `npx tsx tests/analytics-confidence.test.ts` | 6/6 passed |
| Backend unit suite | `npx vitest run` | 42 files, 422 passed |
| Backend lint | `npx eslint src --ext .ts --max-warnings 0` | clean |
| Backend typecheck | `npx tsc --noEmit` | clean |
| Frontend typecheck | `npm run typecheck` | clean |
| Frontend lint | `npm run lint` | clean |
| Frontend production build | `npm run build` | built, 0 errors |

Coverage highlights: team-lead delegation proven without global grants
(positive and negative paths), cross-tenant team assignment rejected with
`404`, `teamId` filters scoping cameras/alerts/incidents/analytics/audit to
exactly one team, realtime frames with a `teamId` withheld from subscribers
whose `teamIds` excludes it, incident team audit metadata (`previousTeamId` /
`nextTeamId` / `teamId`), and `camera_team_assigned` as a dedicated audit
action distinct from generic `camera_updated`.

## Certification changes in this commit

- `docs/api.md` — new "Teams & Resource Grouping" section (CRUD, members,
  invitations, team-lead delegation, the three `PATCH /:id/team` assignment
  endpoints, the `?teamId=` filters across reads/analytics/audit), `teamId`
  added to the analytics filters, `teamIds`/`teamId` documented on the
  realtime stream, and the new Phase 9 audit actions listed.
- `docs/phase-9.md` — this report.

## Deployment notes

- **Migrations**: five additive migrations ship with this phase
  (`20260921203000_add_teams_and_grouping`, `20260921220000_add_team_lead`,
  `20260921220030_add_alert_incident_team`, `20260921223000_add_camera_team`,
  `20260922110000_add_camera_team_audit`); `npx prisma migrate deploy`
  applies them in order. All new columns are nullable with
  `ON DELETE SET NULL`, so existing rows need no backfill.
- **Enum values**: `AuditLogAction` gains team-scoped values; PostgreSQL ≥ 12
  allows adding enum values inside a transaction, matching the earlier
  multi-value migrations.
- **Realtime**: clients that subscribe with `?teamIds=` opt into team-filtered
  frames; subscribers without the filter keep the previous fan-out, so the
  change is backward compatible.

## Non-goals (unchanged)

- Teams are flat (no hierarchy/nesting) — a camera, alert or incident belongs
  to at most one team at a time.
- No team-scoped notification routing beyond the SSE `teamIds` filter and
  existing webhook plumbing.
- Team deletion unbinds (never deletes) its cameras/alerts/incidents via
  `ON DELETE SET NULL`.

See `api.md` for the synchronized endpoint reference, and `deployment.md`
for proxy and environment configuration.
