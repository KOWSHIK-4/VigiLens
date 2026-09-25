# VigiLens Production Security Certification — 2026-09-25

## Outcome

**NOT APPROVED for production.**

VigiLens is well-engineered and shows unusual depth (defense-in-depth, rate limits,
role hierarchy, credential encryption, audit chaining, fail-fast secret validation).
However, the audit found **four confirmed P1 blockers** and multiple P2 items that
must be remediated and re-tested before a production go/no-go approval can be issued.

Read-only security audit. No source or configuration changes were made. Worktree clean
at close (`git status` clean, `origin/main`).

---

## Summary of results

| Area | Result |
| --- | --- |
| Backend prod `npm audit --omit=dev` | 10 findings — 3 moderate / 6 high / 1 critical |
| Backend runtime-reachable vulnerable deps | `multer@2.2.0`, `qs@6.15.3` (via `express@4.22.2` / `body-parser@1.20.6`) |
| Backend critical `tar` | Build/install path only (`bcrypt@5.1.1 → @mapbox/node-pre-gyp@1.0.11 → tar@6.2.1`) |
| Backend lint / typecheck | Pass |
| Frontend prod `npm audit --omit=dev` | **0 findings** |
| Frontend full audit (dev tooling) | 3 high; dev-only (`brace-expansion`, `js-yaml`, `nanoid`) |
| Frontend lint / typecheck / build | Pass |
| Python (`ai`) | Not auditable with local tooling; OSV advisories hit `python-multipart==0.0.19` and `Pillow==11.0.0` |
| `pip-audit` / `safety` / `uv` | Not installed in this environment — OSV web database used instead |
| Full test suite | Not executed (requires Docker/Postgres runtime; audit is read-only) |

---

## P1 — Blockers (must fix + retest before production)

### B1. Seeded accounts with universal default credentials + auto-seeding on deploy

- **Where:**
  - `backend/prisma/seed.ts:141` — `bcrypt.hash("admin123", 12)`
  - `backend/prisma/seed.ts:197-261` — `admin@vigilens.io`, `super@vigilens.io`,
    `operator@vigilens.io`, `viewer@vigilens.io` (active), `disabled@vigilens.io` (disabled)
  - `backend/vercel.json:3` — `installCommand: "npm ci && npx prisma migrate deploy && npx tsx prisma/seed.ts"`
  - `docker-compose.yml` services run without a rotation gate
- **What:** Every fresh database ships four known, active privileged accounts sharing
  the password `admin123`. The Vercel `installCommand` re-executes the seed on install.
  Nothing enforces rotation before the deployment is exposed (the docs only *warn*).
  The password hash is bcrypt-12, but `admin123` is a top-10 password; it will be
  cracked trivially. The Super Admin account is a total-compromise path.
- **Impact:** Full system compromise on a fresh production deployment where the
  operator fails to rotate manually before exposure (evaluation/testing gap).
- **Fix direction:** refuse to run in production without a strong `SEED_DEFAULT_PASSWORD`
  (or require the seed be disabled explicitly); delete/alternate default accounts on
  first boot; fail-fast if any seeded account still has the default password hash; add an
  automated rotation check to CI or deployment gate.

### B2. Anonymous internet-facing AI inference, SSRF, and ingestion abuse via `/detect/*`

- **Where:**
  - `frontend/nginx.conf.template:50-64` — `location /detect/` is a public proxy to the AI service
  - `frontend/docker-entrypoint.d/15-internal-key-header.sh:6-13` — the shared internal key is injected server-side on every `/detect/` request
  - `ai/app/routes/detection.py:27` — key guard is the *only* protection; there is **no user authentication, session check, permission check, or rate limit**
  - `ai/app/routes/detection.py:308-316` — `/detect/webcam` takes untrusted `camera_id`, `device`, `detector`, `snapshot_enabled`, `confidence`
  - `ai/app/routes/detection.py:358-402` — `device` is passed straight into `cv2.VideoCapture(...)` (arbitrary URL / file path → SSRF / local-file probing)
  - `ai/app/routes/detection.py:327-356` — detections are POSTed to the backend internal API with an attacker-supplied `camera_id`
  - `ai/app/routes/detection.py:146-227`, `230-285` — `/detect/image` and `/detect/video` buffer the entire upload in memory with no application-level size cap and no rate limit
- **What:** anyone who can reach the frontend (`:80`) can make unlimited expensive
  detections, open arbitrary HTTP sources inside the AI container's network, read
  endpoint responses through the MJPEG stream, and race forged detections into the
  backend (subject to camera-ID guessing).
- **Impact:** Anonymous compute/DoS attack; SSRF into deployment-internal networks;
  fabricated detection data; unbounded memory growth.
- **Fix direction:** authenticate `/detect/*` (session/JWT or a short-lived stream ticket)
  at the proxy or backend; add per-user rate limiting and a body-size cap (also at the
  proxy — set `client_max_body_size`); restrict `device` to USB indices or an allowlist
  of configured sources; key internal POSTs to the caller's owned cameras only.

### B3. Any tenant admin can modify instance-wide security settings

- **Where:**
  - `backend/src/controllers/settings.controller.ts:23-25` — `settingsScope()` maps category `security` to global scope `""`
  - `backend/src/routes/settings.routes.ts:21-26` — updates gated only by `settings.manage`
  - `backend/src/services/settings.service.ts:217-234` — writes rows at `organizationId: ""`
  - `backend/prisma/seed.ts:99` — the seeded `admin` role includes `settings.manage`
- **What:** `security` settings (password policy, session timeout, MFA enforcement,
  login attempt limits, lockout, rate limits, JWT lifetime) are global, but any tenant
  admin (`settings.manage`) can read and modify them. In a multi-tenant deployment, an
  admin of tenant A can disable MFA everywhere, extend sessions, weaken passwords, or
  change rate limits for all tenants.
- **Impact:** Privilege escalation across tenants; degradation of the entire instance's
  security posture; availability impact (rate-limit weakening/DoS).
- **Fix direction:** reserve `organizationId === ""` scope for `super_admin` (or a
  dedicated instance-admin permission); assert role/scope in the settings controller and
  in `settingsService.update/reset`; add cross-tenant regression tests.

### B4. Backend port published + blind trust of `X-Forwarded-*` (deployment-dependent)

- **Where:**
  - `docker-compose.yml:61-62` — `backend` publishes `"4000:4000"` on the host
  - `backend/src/index.ts:25` — `app.set("trust proxy", 1)` in production
  - `backend/src/controllers/auth.controller.ts:10-15` — audit IP comes from attacker-controlled `X-Forwarded-For`
  - `backend/src/controllers/auth.controller.ts:23-29` — `X-Forwarded-Proto` is authoritative for the HTTPS requirement
  - `backend/src/routes/auth.routes.ts:16-22` + `backend/src/services/rateLimit.service.ts` — limiter keys on `req.ip` (spoofable with `X-Forwarded-For` when connecting directly)
- **What:** with the backend port published and a public firewall, anyone can hit the
  API directly, bypassing the nginx security boundary. They can:
  1. rotate `X-Forwarded-For` to defeat per-client rate limits (brute-force / DoS);
  2. send `X-Forwarded-Proto: https` to bypass `jwt_require_https` even though the
     connection is cleartext;
  3. poison audit-log IP attribution anyway (even through the frontend, since nginx
     appends the *client-supplied* value first).
- **Impact:** weakened auth protections, audit integrity loss, and enlarged attack surface.
- **Fix direction:** do not publish the backend port (scope it to host network only if
  required, or run the SPA/nginx as the only public entrypoint); treat
  `X-Forwarded-*` only when a verified proxy hop exists; derive audit IP from `req.ip`
  (or the right-most trusted hop), never from the raw header; add HSTS in front.

---

## P2 — Should fix before production

1. **Webhook SSRF + plaintext secret at rest.**
   `backend/src/services/webhook.service.ts:118` does `fetch(config.url)`; the only
   validation is `isHttpUrl` (scheme check, `settings/defaults.ts:659-665`), so URLs to
   loopback/private/link-local ranges and redirects to them are allowed. `webhook_secret`
   is stored in plaintext in `SystemSetting.value`. Fix: block private/loopback/link-local
   and disable redirects; encrypt high-value settings; tighten update wording.

2. **Camera-driven SSRF (privileged, by-design surface).**
   `backend/src/services/camera.service.ts:570-583` issues a `HEAD` fetch to the camera
   URL (with decrypted Basic-auth credentials) and `ai/app/routes/capture.py:63-97` opens
   arbitrary sources. `cameraBaseSchema` (`backend/src/types/index.ts:116-137`) only
   enforces a protocol prefix, not network ranges. This is a legitimate product surface,
   but its blast radius should be explicitly bounded (per-deployment camera network
   allowlist / egress control) before production.

3. **`sourceURL` leaks embedded credentials and accepts odd schemes.**
   `backend/src/types/index.ts:130` (`z.string().url()`) accepts embedded `user:pass@`
   userinfo and arbitrary schemes; `camera.service.ts:172-187` sanitizes `url` but
   **not** `sourceURL`; `frontend/src/components/CameraPreview.tsx:69-91` renders it raw
   in an `<img>`. Fix: strip userinfo, restrict schemes (`http(s)/rtsp`), or drop the field.

4. **`userService.update` bypasses role guards.**
   `backend/src/services/user.service.ts:164-186` performs no `assertMayControlRole`.
   Combined with `user.routes.ts:43-49` (only `users.update`) and admin's
   `users.update` permission, a same-organization admin can change the name, email, or
   avatar of the Super Admin (and other admins) — causing login/identity confusion and
   availability issues. Password reset and role assignment are properly guarded; only
   `update` is unprotected. Fix: assert role control in `update`.

5. **Reachable runtime dependency advisories (backend).**
   `multer@2.2.0` (4 CVEs: field-name DoS x2, fd-leak on abort, race-bypass) mounted on
   the authenticated 10 MB image upload (`backend/src/routes/engine.routes.ts:11-18`),
   and `qs@6.15.3` (query parsing on every request via `express@4.22.2` /
   `body-parser@1.20.6`). Upgrade `multer` ≥ 2.3.0 and `express`/`qs` to fixed versions.

6. **AI Python dependency advisories (potentially pre-auth).**
   `ai/requirements.txt` pins `python-multipart==0.0.19` (high-severity advisories,
   reachable via `/detect/image` and `/detect/video` *without auth* because of B2),
   `Pillow==11.0.0` (many recent highs), and an unbounded `numpy>=1.26.0`. This is the
   highest-susceptibility, least-verified dependency set. Add an audited lockfile and a
   `pip-audit` / OSV gate to CI.

7. **Seed leaks bcrypt hashes to deploy logs.**
   `backend/prisma/seed.ts:419` logs the full seeded user objects (`console.log({ admin,
   superAdmin, operator, viewer, disabled })`), which include the `password` hash.
   Remove the log; even more important with B1.

8. **No HSTS / no `upgrade-insecure-requests`; HTTPS not the default.**
   `frontend/nginx.conf.template:16` sets good CSP/headers but omits HSTS; the
   `jwt_require_https` security setting defaults to `false`
   (`settings/defaults.ts:207-211`). Production should ship HSTS and default to HTTPS.

---

## P3 — Notes / informational

- **Storage settings scope bug (not a live host-write).** `storage_base_path` etc. are
  org-scoped on write (`settings.controller.ts:23-25`) but read globally
  (`camera.service.ts:61-65`, `health.service.ts:207-215`), so tenant changes never take
  effect — a functional/config bug. The `mkdir/writeFile/unlink` primitives at
  `health.service.ts:222-226` and `camera.service.ts:680-681` remain a hazard if the
  scope is later fixed without containing the path. No API-exposed path to exploit it today.
- **Public `/health` endpoints** reveal filesystem paths and versions when the backend
  port is reachable directly; keep behind the proxy/firewall.
- **AI internal-key is injection-based.** `INTERNAL_KEY_HEADER` (and the value) are baked
  into the running nginx config; keep the secret out of logs and ensure the frontend
  image is only readable by deployers.

---

## Checks that returned NEGATIVE (good)

- Role hierarchy (`roleHierarchy.ts`) correctly blocks non-Super-Admins from granting or
  demoting Super Admin; `canGrantRole` prevents minting permissions the actor lacks.
- Tenant scoping of users, teams, cameras, detections, and audit is consistently derived
  from the DB row, not JWT claims.
- Camera credentials: AES-GCM at rest, legacy-plaintext auto-migration, scrubbed from all
  API payloads, decryption only on capture/health paths.
- Internal detection ingestion: key-guarded, length-safe `timingSafeEqual`, camera-verified
  org derivation.
- Auth: JWT algorithm/issuer/audience pinned, `tokenVersion` revocation, session
  inactivity timeout, MFA enforcement policy, strict per-account lockout.
- Production fail-fast for JWT secret, internal key, and camera credential key.
- AI service refuses to start in production with the default internal key; CORS wildcard
  stripped in production.
- Black-box dependency counts: backend prod 229 (10 vulns), frontend prod 82 (0 vulns).
- Frontend: no `dangerouslySetInnerHTML`, `eval`, or DOM-Cookie sinks found; CSP with
  `frame-ancestors 'none'`, object `'none'`, strict script sources.

---

## Required re-certification checklist

1. B1–B4 remediated in code/configuration (per fix directions above).
2. `npm audit --omit=dev` (backend) returns 0 prod vulnerabilities (or an approved
   risk register entry with a hard upgrade date) for every **runtime** dependency.
3. `pip-audit` (or OSV gate) added for `ai`; all production pins resolved; numpy pinned.
4. Full `npm test` suite executed green against an isolated Docker/Postgres environment.
5. An anonymous-tool / manual repro of B2 (no-cookie `/detect/image` request) returns 401.
6. Cross-tenant security-settings change (B3) returns 403 for a non-super-admin.
7. Backend port not reachable from outside the host; XFF/XFP spoof attempts produce
   correct audit IPs and limiter keying.
8. Seed logs no hashes; no seeded account can authenticate with `admin123` in staging.
9. HSTS + HTTPS-only production config verified with a browser-context check.
10. Final sign-off performed by a human approver after the retest run.