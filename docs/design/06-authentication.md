# §6 Authentication

View: [OAuth sign-in of an MCP client](../architecture/README.md#oauth-sign-in-of-an-mcp-client).

## 6.1 Admin portal sign-in

The Admin listener (port 8081) has its own sign-in.

**Local users.** Core stores users in the `users` table with an argon2id password hash (`m=64 MiB, t=3, p=1`). Each user has one role (§6.4).

**First user.**

- If there are no users, the portal shows a Setup page to create the first user. The setup endpoint works only while the users table is empty. The first user gets the Admin role.
- For an install without a browser, `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD` create the first user at start if the table is empty. After that, core ignores them and logs a warning if they are still set.

**TOTP (optional, for each user).**

- RFC 6238. The user enrolls on the Profile page with a QR code.
- Core encrypts the secret with the master key.
- Core makes ten single-use recovery codes and stores them as hashes. The profile shows how many are left.
- The user can replace all recovery codes on the Profile page (`POST /api/profile/totp/recovery-codes`). This needs a current code from the app, with the same replay guard as the code step. Core refuses a recovery code. A wrong code gives `401 invalid_code`, and without TOTP core answers `409 totp_disabled`. Core audits `totp_recovery_rotated`.
- With `security.requireTotp`, each user must enroll at the next sign-in.

**OIDC (optional).** The admin configures it on Settings → User auth:

- issuer URL (discovery), client id, client secret (encrypted), scopes. Core checks the issuer URL and the client id only while OIDC is on.
- an allow policy: allowed e-mail addresses, allowed `sub` values, and a required group claim value. An e-mail address counts only if the ID token has `email_verified: true`. A missing claim means "not verified".
  - An e-mail entry is an exact address or `*@domain`. Core compares both without case.
  - A `*@domain` entry accepts an address whose part after the last `@` is that domain. It does not accept subdomains. Core refuses all other wildcard forms.
- The flow is the authorization code flow with PKCE, `state` and `nonce`.
- `autoProvision` is off by default. Then an OIDC identity must be linked to a local user first (Profile → "Link OIDC identity"). If it is on and self-registration is on (§6.5), core creates a user for each identity that the allow policy accepts.
- The IdP redirect is cross-site, so the browser does not send the session cookie. The callback returns a page that opens the link step on the same site. That step links the identity only for the signed-in user who started the link.

**Local sign-in fallback.**

- Local password sign-in is always available, unless `security.disableLocalLogin` is true.
- The admin can set that only while OIDC is on and at least one enabled user is linked to it.
- While it is set, core refuses these actions with 409 `local_login_disabled`: turn OIDC off, unlink, or disable or delete the last enabled linked user.
- `ADMIN_FORCE_LOCAL_LOGIN=true` turns local sign-in on again.

**Sessions.**

- Core stores sessions on the server (`sessions` table). The id is a random 256-bit value. Core stores only its HMAC with a pepper from the master key.
- The cookie is `__Host-syn_admin`: `HttpOnly`, `SameSite=Strict`, `Path=/`, and `Secure` behind TLS.
- A session ends after 30 minutes without use, and after 12 hours in total. Both values are settings.
- Sign-out deletes the session. A password change ends the other sessions of the user.

**Delete a user.** An admin deletes a user (`DELETE /api/users/:id`). The delete is permanent.

- Core refuses to delete the admin who asks, the last user or the last enabled admin. While local sign-in is off, it also keeps the last enabled linked user.
- First, core takes every credential of the user away: sessions, OAuth grants and bearer tokens (§6.2). It also ends their pending approvals and the session grants that they gave (ADR-0006).
- Then, in one transaction, core deletes the user, their personal levels and their own pre-approval rules. It keeps the shared rows that name the user and clears that name (§7.3). It writes the audit event `user_deleted`.
- Core does not change the audit log. The log reads the user name of a deleted user from `user_deleted` (§7.1).

Scenarios: [`@id:user-deletion`](../../packages/core/features/administration/user-deletion.feature), [`@id:users`](../../packages/core/features/administration/users.feature).

**CSRF.** Each request that changes state on `/api/*` or `/auth/*` needs a double-submit token: the `syn_csrf` cookie and the `X-CSRF-Token` header. If `PUBLIC_ADMIN_URL` is set, core also checks `Origin` against it.

**Brute-force protection.**

- Five failed sign-ins for a user name in 15 minutes lock that user name. The lock lasts 15 minutes from the fifth failure.
- Core counts failures for each surface. Failures on the MCP listener sign-in lock the user name there only, never in the admin portal.
- A budget of 60 attempts in 5 minutes applies to each client IP. It covers password sign-in, its code step and the sign-up form on both listeners. It also covers client registration and the connection test.
- Wrong codes and wrong current passwords on the Profile page count toward the lock of the admin portal. This covers new recovery codes, turning off TOTP and a password change. While the user name is locked, core answers `429 locked` there and checks nothing.
- Core audits sign-in failures and wrong codes as `auth` events, on both surfaces. A wrong code is `totp_failed`, and a wrong current password on the Profile page is `password_failed`. On the Profile page, the detail also names the route.

Scenarios: [`@id:first-account`](../../packages/core/features/identity/first-account.feature), [`@id:portal-sign-in`](../../packages/core/features/identity/portal-sign-in.feature), [`@id:portal-sessions`](../../packages/core/features/identity/portal-sessions.feature), [`@id:single-sign-on`](../../packages/core/features/identity/single-sign-on.feature), [`@id:local-sign-in-off`](../../packages/core/features/identity/local-sign-in-off.feature).

## 6.2 MCP client authentication

Client auth is how an MCP client proves who it is on the MCP listener. There are three client auth methods. The admin enables a set of them (Settings → Client auth, `mcp.clientAuth`). By default, `bearer` and `oauth` are on and `external` is off.

| Method     | Accepts                                                                | Recorded identity                            |
| ---------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| `bearer`   | `Authorization: Bearer syn_…` tokens from the portal                   | Token name                                   |
| `oauth`    | OAuth 2.1 access tokens from the built-in authorization server         | OAuth client name and the user who consented |
| `external` | A request that the configured external provider identifies. See below. | `external:<identity>`                        |

**Methods of an endpoint.**

- An endpoint accepts all enabled methods, or a subset of them (Instance → Settings, `plugin_instances.auth_methods`).
- The effective methods are the subset of the endpoint, or all methods, that are also enabled globally.
- If the effective set is empty, core refuses each request to the endpoint. A caller with a live credential gets 403. Other callers get the answer of an unknown slug (401). The portal shows a warning.
- If core cannot read the stored methods, all methods are off.
- Core refuses a save of the settings that enables no method, with 400 `invalid_settings`.

**Method selection.**

1. A request with an `Authorization: Bearer` header uses `bearer` or `oauth`, if the endpoint allows the method. `oauth` also needs `PUBLIC_MCP_URL`.
2. A request without a bearer token uses `external`, if the endpoint allows it.
3. If `external` does not identify the caller and the endpoint also allows `bearer` or `oauth`, core sends the bearer challenge (401).

**`external` method.**

- An external provider identifies the user of each request. The admin selects the provider (`mcp.external.provider`). Core refuses a save that enables `external` while the provider has no configuration.
- Each provider is one module in the provider harness (`auth/external.ts`). The MCP listener uses only the harness, never a provider directly.
- **Cloudflare Access** is the only provider. Its configuration is `mcp.cfAccess.teamDomain` and `mcp.cfAccess.aud`.
  - The `Cf-Access-Jwt-Assertion` header must verify against the JWKS of the team, with `RS256`, the issuer and audience of the application, and `exp` and `iat` claims.
  - The identity is the `email` claim. Core refuses an assertion without an e-mail address.
  - Core refuses the assertion of a service token (an empty `sub`, or a `common_name` claim). A service token is not a user.
- **User.** Core finds the user whose user name is the identity. Upper and lower case do not matter. Only a user that an admin made, or that `external` registered, can match. A user from the sign-up form or OIDC never matches, so nobody can take an external identity first. If there is no such user, self-registration (§6.5) creates one. If self-registration is off, the name is taken, or the identity is not a valid user name, core refuses the request with 403.
- Core refuses a caller that the provider does not identify (401). Each call belongs to a user.
- The approval page also uses the provider to identify the approver, without self-registration (ADR-0006).
- Core does not read any other identity header.

**Bearer tokens** (Clients & Tokens page):

- Format `syn_<base62 of 32 bytes>`. Core shows a token once and stores its SHA-256.
- Fields: name, owner (the user who made it), scope (a list of instance ids, or `*`), access ceiling (`read` by default, or `write`, §6.3), optional expiry, `last_used_at`.
- Each user makes and revokes their own tokens on the Profile page. A user who is not an admin can scope a token only to the endpoints of their role. `*` means all endpoints of the role at the time of each call.
- The admin can revoke a token.
- A token used on an endpoint outside its scope gets 403, not 401.

**Built-in OAuth 2.1 authorization server.** It follows the MCP authorization specification.

- **Protected-resource metadata** (RFC 9728) is at `/.well-known/oauth-protected-resource/{slug}`. It names `PUBLIC_MCP_URL` as the authorization server and has no `resource_name`. It exists only for an endpoint whose effective methods include `oauth`. For other endpoints it returns 404.
- **Order of checks.** A request to `/{slug}` without credentials gets 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/{slug}"` when the endpoint accepts `oauth`. Authentication comes before all other checks:
  - A disabled endpoint answers a stranger like an enabled one. It returns 503 only after authentication.
  - An unknown slug returns 401 with a plain `Bearer` challenge. It returns 404 only to a caller with a valid credential.
- **Authorization-server metadata** (RFC 8414) is at `/.well-known/oauth-authorization-server`.
- **Dynamic client registration** (RFC 7591) is at `/oauth/register`. The admin can turn it off (`oauth.allowDynamicRegistration`). Then the admin registers clients on the Clients & Tokens page. The page lists all clients with their redirect URIs, and the admin can revoke them.
- **`/oauth/authorize`.**
  1. The flow is the authorization code flow. PKCE `S256` is required.
  2. The `resource` parameter (RFC 8707) must give one or more endpoint URLs.
  3. The user signs in on the MCP listener page: local password and TOTP, or OIDC. With `security.requireTotp`, core refuses a user without TOTP.
  4. The consent page shows the client name, the host of its redirect URI, and the requested endpoints.
  5. The user can remove endpoints from the list. They select the access ceiling (§6.3).
- **`/oauth/token`.**
  - Access tokens are opaque and valid for 1 hour by default. Core stores them as hashes. Their audience is the granted resources.
  - Refresh tokens change at each use, with a sliding window of 30 days by default. If core sees a used refresh token again, it revokes the full token family.
- **Grants are bound to instances, not slugs.** Core records the instance that each consented URL named at consent time. It checks tokens against these instance ids.
  - A renamed endpoint keeps its grants.
  - A new endpoint that takes an old slug does not get the old grants.
  - When an endpoint is deleted, core revokes grants that cover nothing else.
- **Revocation.**
  - The Clients & Tokens page lists the grants of each user and client. The admin can revoke them.
  - A password change or a disabled user revokes all grants of the user, and their tokens.
  - A disabled user also loses the bearer tokens that they made, and the session grants that they gave (ADR-0006). `refresh` refuses a disabled user.
  - A deleted user loses all grants, their tokens and the bearer tokens that they made (§6.1).
  - When the admin enables a user again, no grant or token comes back.

**Scope check.** For each request to `/{slug}`, core checks that the scope or audience of the credential includes that instance. This applies to both token kinds.

**Owner check.** Each credential has an owner: the user who made the token, the user who gave the OAuth consent, or the user that the `external` method finds. For each request, the owner must be enabled and the role of the owner must have the instance. Otherwise core refuses the request with 403. The consent page shows only the endpoints of the role of the user.

Scenarios: [`@id:client-auth-methods`](../../packages/core/features/client-auth/client-auth-methods.feature), [`@id:bearer-tokens`](../../packages/core/features/client-auth/bearer-tokens.feature), [`@id:access-gateway`](../../packages/core/features/client-auth/access-gateway.feature), [`@id:oauth-discovery`](../../packages/core/features/client-auth/oauth-discovery.feature), [`@id:oauth-clients`](../../packages/core/features/client-auth/oauth-clients.feature), [`@id:oauth-consent`](../../packages/core/features/client-auth/oauth-consent.feature), [`@id:oauth-tokens`](../../packages/core/features/client-auth/oauth-tokens.feature).

## 6.3 Access ceiling

Each credential has an access ceiling: `read` or `write`.

- On the OAuth consent page, the user selects "Read only" (the default) or "Read & write". The ceiling is stored on the grant. All access and refresh tokens of the grant have it. A wider ceiling needs a new consent.
- A bearer token has the same field, `read` by default.
- A principal with ceiling `read` never reaches a write, whatever the access levels are (ADR-0004).
- The `external` method trusts the external provider. Core does not limit its principals.

The person who connects a client decides once what the client can ever do.

Scenarios: [`@id:access-levels`](../../packages/core/features/access/access-levels.feature), [`@id:oauth-consent`](../../packages/core/features/client-auth/oauth-consent.feature).

## 6.4 Roles

Each user has one role. A role decides what the user can reach and change.

**Admin role.** It is built in, and nobody can change or delete it. An admin does all administration. Its access levels are the levels of each endpoint (ADR-0004). Core refuses a change that leaves no enabled admin (409 `last_admin`).

**Other roles.** An admin makes them on the Roles page. Each role has:

| Part                | Meaning                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Endpoints           | The endpoints that the role has. For other endpoints, the credentials of its users get 403.               |
| Endpoint switches   | Three switches on each endpoint of the role. See the table below.                                         |
| Role maximums       | For each group, and for an operation if necessary, the highest level. Not set means `none`. See ADR-0004. |
| See other endpoints | A role-wide switch. Users see the other endpoints by name and description, without access. Default: off.  |

Each switch applies only on its endpoint. The Admin role has all switches on, on each endpoint.

| Endpoint switch        | Meaning                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Set personal levels    | Users set a personal level for each group or operation, at most the role maximum.                                                               |
| Own pre-approval rules | Users add pre-approval rules that apply only to their own calls (ADR-0003).                                                                     |
| See endpoint status    | Users see the state, plugin, upstream version and last sync of the endpoint. They also see all its groups and operations, also those at `none`. |

**What each user gets.**

- Their profile, their own bearer tokens and their own OAuth grants.
- A read-only list of the endpoints of their role, the operations that they can call, and the level in force for each.
- Also the operations that only their personal level closes, with the reason `own_level`. The portal shows them as "Off: your own level" and keeps their level controls, so that the user can open them again.
- With "See endpoint status" on an endpoint, also the operations that they cannot call for another reason. These show as off, with no level to set.
- With "See other endpoints", a list of the other endpoints. Each shows only its slug, display name, plugin name and plugin description, and the name of their role. An admin has no other endpoints.
- On each endpoint, the parts that the switches of their role on that endpoint allow. Core refuses the other parts with 403.
- An approval page for their own calls only (ADR-0006).

**Rules.**

- A new endpoint, and a new group from a sync, start at `none` for each role.
- A change to a role or to a role maximum applies to the next call. It also applies to a parked execution before it continues.
- A user can write own rules only for operations that they can call. The rule editor of the user gets option lists and registry entries only for these operations, and registry entries without their attributes.
- Core refuses a manifest in which a match field and a connection-form field use the same options source.
- "See other endpoints" gives no access. Core answers 404 for the levels, rules and status of such an endpoint, and 403 to MCP calls.

Scenarios: [`@id:roles`](../../packages/core/features/administration/roles.feature), [`@id:my-instances`](../../packages/core/features/administration/my-instances.feature), [`@id:own-credentials`](../../packages/core/features/administration/own-credentials.feature), [`@id:role-access`](../../packages/core/features/access/role-access.feature).

## 6.5 Self-registration

Self-registration is off by default. It is on while an admin sets a default role (Settings → User auth). The default role can be any role, also Admin. The portal then asks for a typed confirmation.

A user that self-registration makes gets the default role. Core records the source in `registered_via` and audits it as `user_registered`. While self-registration is on, a deleted `oidc` or `external` user comes back as a new user at their next sign-in (§6.1). User names are unique without regard to case. A name from the sign-up form or OIDC cannot contain `:`. The sign-up form gives one error for a taken name, and does not tell that the name exists.

| Source     | When                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `oidc`     | OIDC `autoProvision` is on and the allow policy accepts the identity.                                                          |
| `external` | The external provider (§6.2) identifies a caller with no user.                                                                 |
| `signup`   | The "Create account" form on the sign-in page. It needs `localSignup` and local sign-in on. The per-IP budget of §6.1 applies. |

Scenarios: [`@id:self-registration`](../../packages/core/features/administration/self-registration.feature).

## 6.6 MCP client policy

The client policy allows or denies MCP clients by their client name. The client name is the `clientInfo.name` that a client sends in its MCP `initialize` request. The admin sets the policy under Settings → Client auth (`mcp.clientPolicy`).

| `mode`          | Core refuses                                                     |
| --------------- | ---------------------------------------------------------------- |
| `off` (default) | No client                                                        |
| `allow`         | A client whose name is not in `names`, and a client with no name |
| `deny`          | A client whose name is in `names`                                |

- `names` holds at most 50 names of 1 to 100 characters. Core trims each name and removes duplicates.
- The match is exact, but upper and lower case do not matter.
- Core refuses a save of `allow` mode with no names, with 400 `invalid_settings`.
- **When.** Core checks the policy after authentication (§6.2), on an `initialize` request, before it makes the MCP session. It reads the client name from the request body. It reads the body once, with the limits of the MCP transport (4 MiB and 100 messages in a batch). Core checks the policy again on each later request of a session. A policy change thus ends an open session of a refused client at its next request.
- **Refusal.** Core answers 403 with the JSON-RPC error `-32003` "This MCP client is not allowed on this server". It keeps no session. It logs the refusal with the client name in the server log. It writes an `auth` audit event `client_refused` with the slug, the client name and the mode.
- **Seen clients.** Core keeps in memory the last 50 client names that opened an MCP session, for the admin to add to the policy. A restart clears the list.
- **Limit.** A client declares its own name, and any client can send any name. The policy stops honest clients that the admin does not want. It is not a security boundary. Client auth (§6.2), the access ceiling (§6.3) and the gate (ADR-0003) are the boundary.

Scenarios: [`@id:client-policy`](../../packages/core/features/client-auth/client-policy.feature).
