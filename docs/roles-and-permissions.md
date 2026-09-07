# Roles & Permissions

VigiLens ships with role-based access control (RBAC). Every API route and page
in the UI is authorized against a set of granular permission keys, so users
only see the data and actions their role allows.

> The source of truth for this document is `backend/prisma/seed.ts`
> (`permissionDefinitions`, `rolePermissionMap` and `roleDefinitions`).

## Enforcement

Permissions are enforced in two layers so the UI can never bypass the API:

- **Backend (authoritative)** — Express middleware (`requirePermission`)
  rejects requests with `403 Insufficient permissions` when the caller's role
  is missing the required key. See the route files in `backend/src/routes`.
- **Frontend (UX)** — pages hide or disable actions based on the current
  user's permissions (`hasPermission(user, key)` in
  `frontend/src/utils/permissions.ts`, populated from the `/auth/me` payload),
  and show read-only banners and neutral empty states when actions are missing.

## Built-in Roles

| Role          | Description                                                            |
|---------------|------------------------------------------------------------------------|
| `super_admin` | Full unrestricted access to every VigiLens resource                    |
| `admin`       | Manage users, cameras, AI models and view analytics & reports          |
| `operator`    | Monitor cameras and detections, control streams and manage alerts      |
| `viewer`      | Read-only access to monitoring data and reports                        |

`super_admin` is always granted by `hasPermission` and implicitly passes every
`requirePermission` check. Roles are mutable — an administrator can edit a
role's permission set from the Roles page, and custom roles can be created.

## Permission Catalog

| Key                        | Category      | Description                                              |
|----------------------------|---------------|----------------------------------------------------------|
| `dashboard.view`           | dashboard     | View the monitoring dashboard                            |
| `users.read`               | users         | List and inspect user accounts                           |
| `users.create`             | users         | Create new user accounts                                 |
| `users.update`             | users         | Update user account details                              |
| `users.delete`             | users         | Remove user accounts                                     |
| `users.manage`             | users         | Full management of user accounts                         |
| `users.assign_role`        | users         | Change the role of a user                                |
| `users.reset_password`     | users         | Trigger password resets for users                        |
| `users.toggle_status`      | users         | Activate or deactivate user accounts                     |
| `users.lock`               | users         | Lock user accounts after incidents                       |
| `users.unlock`             | users         | Unlock previously locked user accounts                   |
| `roles.read`               | roles         | View roles and their permissions                          |
| `roles.manage`             | roles         | Create, edit and delete roles and permission sets        |
| `cameras.read`             | cameras       | View camera feeds and health                             |
| `cameras.manage`           | cameras       | Create, edit and delete cameras                          |
| `cameras.control`          | cameras       | Start and stop camera streams                            |
| `detections.read`          | detections    | View detection events                                    |
| `detections.view`          | detections    | Access the detections feed                               |
| `detections.manage`        | detections    | Delete and clean up detection events                     |
| `models.read`              | models        | View AI model catalog                                    |
| `models.manage`            | models        | Create, edit, load and test AI models                    |
| `models.run`               | models        | Trigger on-demand inference through the detector engine  |
| `analytics.read`           | analytics     | View analytics dashboards                                |
| `reports.read`             | reports       | View and download reports                                |
| `reports.manage`           | reports       | Generate and delete reports                              |
| `reports.generate`         | reports       | Generate on-demand reports                               |
| `alerts.read`              | alerts        | View alert notifications                                 |
| `alerts.manage`            | alerts        | Acknowledge, mark and delete alerts                      |
| `audit.read`               | audit         | View system audit logs and activity history              |
| `audit.export`             | audit         | Export audit logs to CSV format                          |
| `audit.view`               | audit         | Access the audit trail module                            |
| `settings.read`            | settings      | View system settings and configuration                   |
| `settings.manage`          | settings      | Change system settings and configuration                 |
| `monitoring.read`          | monitoring    | View system health, status and performance metrics       |
| `monitoring.manage`        | monitoring    | Start and stop the continuous monitoring scheduler       |

## Role Matrix

| Permission            | super_admin | admin | operator | viewer |
|-----------------------|-------------|-------|----------|--------|
| `dashboard.view`      | ✔           | ✔     | ✔        | ✔      |
| `users.read`          | ✔           | ✔     | —        | —      |
| `users.create`        | ✔           | ✔     | —        | —      |
| `users.update`        | ✔           | ✔     | —        | —      |
| `users.delete`        | ✔           | ✔     | —        | —      |
| `users.manage`        | ✔           | ✔     | —        | —      |
| `users.assign_role`   | ✔           | ✔     | —        | —      |
| `users.reset_password`| ✔           | ✔     | —        | —      |
| `users.toggle_status` | ✔           | ✔     | —        | —      |
| `users.lock`          | ✔           | ✔     | —        | —      |
| `users.unlock`        | ✔           | ✔     | —        | —      |
| `roles.read`          | ✔           | ✔     | —        | —      |
| `roles.manage`        | ✔           | —     | —        | —      |
| `cameras.read`        | ✔           | ✔     | ✔        | ✔      |
| `cameras.manage`      | ✔           | ✔     | —        | —      |
| `cameras.control`     | ✔           | ✔     | ✔        | —      |
| `detections.read`     | ✔           | ✔     | ✔        | ✔      |
| `detections.view`     | ✔           | ✔     | ✔        | ✔      |
| `detections.manage`   | ✔           | ✔     | —        | —      |
| `models.read`         | ✔           | ✔     | ✔        | ✔      |
| `models.manage`       | ✔           | ✔     | —        | —      |
| `models.run`          | ✔           | ✔     | ✔        | —      |
| `analytics.read`      | ✔           | ✔     | —        | ✔      |
| `reports.read`        | ✔           | ✔     | —        | ✔      |
| `reports.manage`      | ✔           | ✔     | —        | —      |
| `reports.generate`    | ✔           | ✔     | —        | —      |
| `alerts.read`         | ✔           | ✔     | ✔        | ✔      |
| `alerts.manage`       | ✔           | ✔     | ✔        | —      |
| `audit.read`          | ✔           | ✔     | —        | —      |
| `audit.export`        | ✔           | ✔     | —        | —      |
| `audit.view`          | ✔           | ✔     | —        | —      |
| `settings.read`       | ✔           | ✔     | —        | —      |
| `settings.manage`     | ✔           | ✔     | —        | —      |
| `monitoring.read`     | ✔           | ✔     | —        | —      |
| `monitoring.manage`   | ✔           | ✔     | —        | —      |

## Seeded Accounts

`npm run prisma:seed` (in `backend/`) creates five test accounts. All active
accounts share the default password `admin123` — **change these credentials
before any real deployment**:

| Email                  | Role         | Status    |
|------------------------|--------------|-----------|
| `super@vigilens.io`    | `super_admin`| active    |
| `admin@vigilens.io`    | `admin`      | active    |
| `operator@vigilens.io` | `operator`   | active    |
| `viewer@vigilens.io`   | `viewer`     | active    |
| `disabled@vigilens.io` | `viewer`     | disabled  |

Disabled accounts are rejected at login and on every request. Locked accounts
must be unlocked by an administrator before they can authenticate again.