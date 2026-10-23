---
status: accepted
date: 2026-10-07
---

# Trust boundaries

## Context and Problem Statement

Core makes every security decision (ADR-0001). Which boundaries does core guard, with which controls, and which risks does it accept?

## Considered Options

- One control for each boundary, as the table below lists, with the remaining risks accepted and named.
- No list. Each module guards what it owns.

## Decision Outcome

Chosen option: "One control for each boundary", because a review and a security audit need one place that says what each boundary is and what holds it.

| Boundary                    | Controls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Internet → admin            | A separate port that the proxy does not publish. Sign-in with TOTP or OIDC, sessions, CSRF and lockout.                                                                                                                                                                                                                                                                                                                                                                                                |
| Internet → MCP endpoint     | Client auth methods enabled globally and narrowed for each endpoint. Scoped tokens and grants, 403 outside the scope, and the access ceiling `read` by default. Each credential has an enabled owner whose role has the endpoint. The `external` method accepts only a user that the external provider identifies with a verified assertion.                                                                                                                                                           |
| User → admin                | Only the Admin role uses admin routes. All other routes are admin-only unless listed. A role maximum and a personal level never open more than the endpoint level. Own rules apply only to their owner.                                                                                                                                                                                                                                                                                                |
| MCP client → upstream       | The sandbox gives access only to the binding. The gate decides each call. Then the plugin `invoke` runs.                                                                                                                                                                                                                                                                                                                                                                                               |
| Model → configuration       | No MCP tool changes configuration. The sandbox has no database access.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Plugin → core secrets       | A child process under the Node permission model, with a clean environment and the secrets of its own instance only.                                                                                                                                                                                                                                                                                                                                                                                    |
| Plugin supply chain         | Pinned versions, sha256, optional pinned-key signatures, warnings for unsigned plugins and prebuilt packages only. A manual install needs an admin, and the portal shows the unsigned warning first.                                                                                                                                                                                                                                                                                                   |
| Approvals                   | Only the owner of the calling credential decides, on the approval page. Core identifies the owner by a page sign-in, or by the external provider of an endpoint that allows `external`. The answer of the calling client never approves, except opted-in in-session approvals of operations that are not locked. The approval card decides nothing else. Approvals are hash-bound and single use, with a typed confirmation. Parameters stay in memory only, and core checks access and targets again. |
| Plugin change during a call | The gate refuses a call if the bundle changed after the call was gated.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Secrets at rest             | AES-256-GCM, a master key outside the database, APIs that only write secrets, and redaction everywhere.                                                                                                                                                                                                                                                                                                                                                                                                |
| Audit                       | Append-only. It records calls, searches, configuration, sign-ins and plugin events. The model never sees it.                                                                                                                                                                                                                                                                                                                                                                                           |

### Remaining risks

Core accepts these risks. A security review does not report them again.

1. An installed plugin that is malicious can give wrong classifications or locks for its own upstream. It can also connect to any network host. The trust flow for plugin repositories and a container egress policy reduce this risk. Core does not.
2. The `external` method accepts each user that the Cloudflare Access application lets in. The Access policy, not core, decides who that is. Core refuses service tokens.
3. SQLite allows one writer, so there is one core process. Issue #110 tracks more than one.
4. A session grant lets a client run each `ask` operation of one endpoint without a human, for up to `sessionGrantMaxHours`. During that time, a client under prompt injection can make these calls. Locked and typed-confirmation operations, the write rate limit, revoke and the audit log limit this risk.
5. Without the approval card, the agent shows the approval link as text. An agent under prompt injection can show another link. The real page needs the owner, identified as for URL elicitation, and a POST with a CSRF token.
6. A parked execution keeps an isolate and the real parameters in memory until its approval ends. The parked limits, the stop after an approval that is not given, and the limit of 10 approvals for each execution bound this.
7. The approval page asks for no TOTP code. A browser that stays signed in, for up to `approvalSessionAbsoluteDays`, can approve calls and give session grants without a new sign-in. A locked operation still needs its typed confirmation. A TOTP change and **Sign out all approval browsers** in the profile end these sessions.
8. Self-registration with the Admin role as default role makes each new user an admin. That includes each identity that the external provider identifies. The portal asks for a typed confirmation, and self-registration is off by default.
9. On an endpoint that allows `external`, the approval page accepts the identity from the external provider. A client can hold the provider identity of the user, for example a Cloudflare Access token. That client can open the approval link and approve its own call. There, approvals guard against mistakes of the agent, not against a hostile client.
10. In-session approval lets the calling client approve its own `ask` calls: a form answer or an `approval_decide` call comes from the client. A client under prompt injection can then approve these calls. A client that accepts prompts automatically also approves these calls. The setting is off by default and the portal warns about it. Locked and typed-confirmation operations still need the page. Core checks the setting again at each card decision, and the audit records the channel.
11. The MCP client policy matches a client name that the client declares itself. A client can send the name of another client and pass an allow list or a deny list. The policy is not a security boundary. Client auth, the access ceiling and the gate are the boundary.
12. A manual install runs code that no repository signed. If the build does not change the permissions of the plugin, the plugin stays enabled. This is also true for a plugin from a signed repository. Its endpoints serve the unsigned code at once, with no second review. The click of the admin on Install, after the unsigned warning, is the review of the code. An admin session that an attacker controls can install any code this way, as it can with an unsigned repository.
13. An installed plugin can stop core with a signal, because its process runs as the same user as core. A container restart policy starts core again. A plugin cannot open the debugger of core (ADR-0014). Nothing a plugin writes on its message pipe stops core (ADR-0020).

### Consequences

- Good, because the security reviewer and Cloudflare's security audit check a change against one table.
- Bad, because a new boundary needs a change to this ADR in the same pull request.

The model views `containers`, `coreComponents`, `execute`, `approval` and `deployment` show these boundaries.
