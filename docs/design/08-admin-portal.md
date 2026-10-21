# §8 Admin portal

The admin portal is a Vue 3 single-page app (Vite, vue-router). The Admin listener serves it as static files. Its visual style uses the Synoikia brand, in a light and a dark theme. Terracotta marks the one primary action of a page. The fonts are Fraunces for the word mark and IBM Plex Sans and Mono for all other text.

| Concern       | Design                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server data   | `@tanstack/vue-query`. Pages read and change Admin API data through shared composables. A sign-out or a change of user clears the cached data.                                                                                                                      |
| Client state  | Two Pinia setup stores: the sign-in session, and the `/api/events` stream. An event makes the queries of its data stale.                                                                                                                                            |
| Confirmations | `ModalDialog`, also through the shared confirm and prompt dialog. The portal does not use the native browser dialogs.                                                                                                                                               |
| Accessibility | A skip link to the page content. On a route change, the portal moves focus to the content, sets the page title and announces it. One polite live region announces short messages, for example "Copied". The arrow keys, Home and End operate tabs and radio groups. |

## 8.1 Navigation

```
┌ Sidebar ──────────────────┐
│ Synoikia                  │
│ Overview                  │  all endpoints
│ ENDPOINTS                 │
│ ▾ /acme      ● Ready      │  open when selected
│     Connection            │
│     Access                │  access levels (ADR-0004)
│     Pre-Approval Rules    │
│     Settings              │
│ ▸ /other     ● Error      │
│ + New endpoint            │
│ Plugins                   │
│ Clients & Tokens          │
│ Settings                  │
│ Audit Log                 │  all instances
│ ───────────────────────── │
│ My profile                │
│ admin · Sign out          │
└───────────────────────────┘
```

The sidebar above is the one of an admin. A user with another role (ADR-0010) sees only "My endpoints", the endpoints of the role, and "My profile". "My profile" and the user name in the sidebar footer open `/profile` for every role. The portal sends a user with another role from an admin page, and from all Settings tabs, to "My endpoints". The Admin API refuses the admin routes anyway (§8.4).

## 8.2 Pages

Each page reads and changes data only through the Admin API (§8.4). The Admin API decides who can do what. The portal only hides what a role cannot use.

| Page                   | Content                                                                                                                                             | Scenarios                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sign in**            | Password, the TOTP step, OIDC, lockout messages, and the sign-up form while it is on (ADR-0010).                                                    | [`@id:sign-in`](../../packages/admin-ui/features/sign-in/sign-in.feature)                                                                                                                                                                                        |
| **Setup**              | Only while there are no users: the first admin.                                                                                                     | [`@id:sign-in`](../../packages/admin-ui/features/sign-in/sign-in.feature)                                                                                                                                                                                        |
| **My endpoints**       | For every user: the endpoints of the role, their operations and the level in force. Personal levels and own rules as the switches allow (ADR-0010). | [`@id:portal-my-instances`](../../packages/admin-ui/features/my-instances/portal-my-instances.feature)                                                                                                                                                           |
| **Overview**           | Admin only. A card for each instance, plugin child and notifier health, and how to connect a client.                                                | [`@id:portal-shell`](../../packages/admin-ui/features/shell/portal-shell.feature)                                                                                                                                                                                |
| **New endpoint**       | Plugin, slug, display name, client auth methods, in-session approval (ADR-0006), and the connection form (§8.3).                                    | [`@id:portal-instances`](../../packages/admin-ui/features/instances/portal-instances.feature)                                                                                                                                                                    |
| **Connection**         | The connection form (§8.3), Test connection, the status and the last sync.                                                                          | [`@id:portal-instances`](../../packages/admin-ui/features/instances/portal-instances.feature)                                                                                                                                                                    |
| **Access**             | The levels of the endpoint (ADR-0004), or the role maximums of another role.                                                                        | [`@id:portal-instances`](../../packages/admin-ui/features/instances/portal-instances.feature), [`@id:portal-roles`](../../packages/admin-ui/features/roles/portal-roles.feature)                                                                                 |
| **Pre-Approval Rules** | The rules of the endpoint (ADR-0003). Locked operations are not in the picker.                                                                      | [`@id:portal-instances`](../../packages/admin-ui/features/instances/portal-instances.feature)                                                                                                                                                                    |
| **Endpoint Settings**  | The settings of the instance: client auth methods, approvals, session grants (ADR-0006), limits, extra redaction keys, and delete.                  | [`@id:portal-instances`](../../packages/admin-ui/features/instances/portal-instances.feature)                                                                                                                                                                    |
| **Audit Log**          | All instances, with filters and CSV export.                                                                                                         | [`@id:portal-audit`](../../packages/admin-ui/features/audit/portal-audit.feature)                                                                                                                                                                                |
| **Plugins**            | Installed plugins, install from file (ADR-0013), available plugins and repositories (ADR-0013).                                                     | [`@id:portal-plugins`](../../packages/admin-ui/features/plugins/portal-plugins.feature)                                                                                                                                                                          |
| **Clients & Tokens**   | Bearer tokens, OAuth clients and OAuth grants (ADR-0009).                                                                                           | [`@id:portal-tokens`](../../packages/admin-ui/features/clients/portal-tokens.feature)                                                                                                                                                                            |
| **Settings**           | Admin only. Six tabs: Client auth, User auth, Users, Roles, Notifications and Server settings.                                                      | [`@id:portal-settings`](../../packages/admin-ui/features/settings/portal-settings.feature), [`@id:portal-users`](../../packages/admin-ui/features/users/portal-users.feature), [`@id:portal-roles`](../../packages/admin-ui/features/roles/portal-roles.feature) |
| **My profile**         | Every user, at `/profile`. Own bearer tokens and OAuth grants, password, TOTP and new recovery codes, OIDC link, theme, and approval browsers.      | [`@id:portal-profile`](../../packages/admin-ui/features/profile/portal-profile.feature)                                                                                                                                                                          |

Keyboard and screen reader use: [`@id:portal-accessibility`](../../packages/admin-ui/features/accessibility/portal-accessibility.feature).

## 8.3 Plugin UI from data

Plugins never send JavaScript to the portal. The plugin parts of the UI come from JSON Schema and UI hints. A fixed widget library in core shows them:

| Widget                                    | Use                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`, `url`, `number`, `bool`, `select` | Connection fields, simple match fields                                                                                                                                                                                                            |
| `secret`                                  | Write-only credential fields: a hint and "Rotate"                                                                                                                                                                                                 |
| `multiselect`                             | Fixed options, or options from `optionsFor(source)`                                                                                                                                                                                               |
| `prefix`                                  | A path or name prefix                                                                                                                                                                                                                             |
| `range`                                   | A number range with a unit                                                                                                                                                                                                                        |
| `registry-picker`                         | A `$targets` selector from the plugin `targets` (ADR-0011): one chips input for each scope that the field offers, with suggestions from the registry, and one for target ids. It uses `GET /api/instances/:id/registry?kind=&text=&scope.<key>=`. |
| `diff`                                    | The before and after values on the approval page                                                                                                                                                                                                  |

A new widget is a core change. A manifest with an unknown widget name is not valid, so a plugin cannot fall back to a free-text field without notice.

- `showWhen: { field, in: [...] }` shows a connection field only for some values of another field.
- `connection.help` (Markdown) shows above the form as setup steps.
- Conditional requirements use JSON Schema (`allOf` with `if` and `then`). The server validates them.

Scenarios: [`@id:plugin-manifest`](../../packages/plugin-sdk/features/manifest/plugin-manifest.feature), [`@id:portal-instances`](../../packages/admin-ui/features/instances/portal-instances.feature).

## 8.4 Admin API

All routes are on the Admin listener and return JSON. `/api/*` routes need a session cookie. Routes that change state need the CSRF token.

Only an admin can use a route, with these exceptions: `/api/session`, `/api/setup`, `/api/profile/*` and `/api/me/*`. Core refuses all other routes with 403 for a user with another role. A new route is therefore admin-only. The `/api/me/*` routes check the switches of the role on the endpoint, and return 404 for an endpoint that is not in the role.

```
POST   /auth/login | /auth/totp | /auth/logout | /auth/register (sign-up form, ADR-0010)
GET    /auth/oidc/start | /auth/oidc/callback | /auth/oidc/link
GET    /api/session              POST /api/setup (only while there are no users)
GET    /api/overview             GET  /api/events (SSE: instance status, sync progress, lockouts)
GET    /api/profile              POST /api/profile/password | /totp/begin | /totp/confirm | /totp/disable | /oidc/unlink
POST   /api/profile/totp/recovery-codes {code}   (new recovery codes, ADR-0008)
GET/POST /api/users              PATCH /api/users/:id         POST /api/users/:id/reset-totp
GET    /api/settings             PUT  /api/settings/:section   PUT /api/settings/oidc
GET    /api/settings/mcp/clients-seen (client names seen at initialize, @id:client-policy)
GET    /api/plugins              PATCH /api/plugins/:id {enabled}   DELETE /api/plugins/:id
POST   /api/plugins/install {repoId, pluginId, version}    POST /api/plugins/rescan
POST   /api/plugins/uploads (raw tarball, ADR-0013)   POST /api/plugins/uploads/:uploadId/install
POST   /api/plugins/:id/revert
GET/POST /api/plugin-repos       DELETE /api/plugin-repos/:id
POST   /api/plugin-repos/:id/refresh | /confirm-key {publicKey}     GET /api/plugin-repos/available
GET/POST /api/instances          GET/PATCH/DELETE /api/instances/:id
GET/PUT  /api/instances/:id/connection     POST /api/instances/:id/connection/test
POST   /api/instances/:id/sync
GET    /api/instances/:id/groups
PATCH  /api/instances/:id/groups/:key {level?, label?, acknowledge?}
         (level write needs acknowledge = the exact list of writes; 409 if not current)
POST   /api/instances/:id/groups/merge {from, into, label?}
POST   /api/instances/:id/groups/bulk-level {level, confirm?, acknowledge?}
         (write needs confirm = the slug and the acknowledge list; 409 if not current)
GET    /api/instances/:id/operations?group=&q=&reason=
PATCH  /api/instances/:id/operations/:opId {level? (null = follow the group), acknowledged?, attestationRequired?}
         (409 for level write on a locked operation)
GET    /api/instances/:id/registry          GET /api/instances/:id/options/:source
GET/POST /api/instances/:id/rules           PATCH/DELETE /api/instances/:id/rules/:ruleId (409 on a locked operation)
GET    /api/audit                           GET /api/audit/export.csv
GET/POST/DELETE /api/tokens {name, scope, access, expiresAt}
GET/POST/DELETE /api/oauth/clients          GET/DELETE /api/oauth/grants
GET/POST/PATCH/DELETE /api/notifiers        POST /api/notifiers/:id/test
GET    /api/roles  → [{…, endpoints: [{instanceId, canSetOwnLevels, canManageOwnRules, canSeeStatus}]}]
POST   /api/roles                   PATCH/DELETE /api/roles/:id        PUT /api/roles/:id/instances {instanceIds}
PATCH  /api/roles/:id/endpoints/:instanceId {canSetOwnLevels?, canManageOwnRules?, canSeeStatus?}
GET    /api/roles/:id/endpoints/:instanceId/access
PUT    /api/roles/:id/endpoints/:instanceId/groups/:key | /operations/:opId {level (null = not set)}
POST   /api/roles/:id/endpoints/:instanceId/bulk-level {level}

Every user:
GET    /api/me/endpoints  → {assigned, unassigned}   GET /api/me/endpoints/:id/access
GET    /api/me/endpoints/:id/about         (an unassigned endpoint, with "See other endpoints"; else 404)
PUT    /api/me/endpoints/:id/groups/:key | /operations/:opId {level (null = follow the role)}   (Set personal levels)
GET    /api/me/endpoints/:id/rule-form     GET/POST /api/me/endpoints/:id/rules
GET    /api/me/endpoints/:id/options/:source   GET /api/me/endpoints/:id/registry?kind=
PATCH/DELETE /api/me/endpoints/:id/rules/:ruleId                                             (Own pre-approval rules)
GET/POST/DELETE /api/me/tokens      GET/DELETE /api/me/grants
```

Each route that changes state writes a `config` audit event with the values before and after, with secrets redacted. The "configuration changes" filter of the audit log is `kind=config`.

Scenarios: [`@id:admin-api-basics`](../../packages/core/features/administration/admin-api-basics.feature), [`@id:audit-log`](../../packages/core/features/administration/audit-log.feature).
