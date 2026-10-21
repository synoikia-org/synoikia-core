---
status: accepted
date: 2026-10-11
---

# Roles and self-registration

## Context and Problem Statement

A household or a team shares one Synoikia server. Not every user may administer it, and not every user may reach every endpoint. Some installs let people register themselves. What can each user reach and change?

## Decision Drivers

- Only admins may change the security settings of the server.
- A role must only take access away from the endpoint levels, never add it (ADR-0004).
- A role must not let a user see what the role keeps from them.
- Self-registration must be off unless an admin turns it on.

## Considered Options

- One role for each user: the built-in Admin role, or a role that an admin makes, with endpoints, switches and role maximums.
- Admin and read-only users only.
- Permissions for each user, without roles.

## Decision Outcome

Chosen option: "One role for each user". An admin sets access for groups of users once, and a role can only limit what the endpoint allows.

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
- Also the operations that only their personal level closes, with the reason `own_level`. The portal shows them as "Off: your own level" and keeps their level controls.
- With "See endpoint status" on an endpoint, also the operations that they cannot call for another reason. These show as off, with no level to set.
- With "See other endpoints", the slug, display name, plugin name and plugin description of each other endpoint, and the name of their role.
- On each endpoint, the parts that the switches of their role allow. Core refuses the other parts with 403.
- An approval page for their own calls only (ADR-0006).

**Rules.**

- Only the Admin role uses the admin routes of the Admin API. Each user uses `/api/profile` and `/api/me`.
- A new endpoint, and a new group from a sync, start at `none` for each role.
- A change to a role or to a role maximum applies to the next call. It also applies to a parked execution before it continues.
- A user can write own rules only for operations that they can call. Their rule editor gets option lists and registry entries only for these operations, without registry attributes.
- Core refuses a manifest in which a match field and a connection-form field use the same options source. `optionsFor` cannot tell an admin from a user.
- "See other endpoints" gives no access. Core answers 404 for the levels, rules and status of such an endpoint, and 403 to MCP calls.

**Self-registration.** It is off by default. It is on while an admin sets a default role (Settings → User auth). The default role can be any role, also Admin, and the portal then asks for a typed confirmation.

- A self-registered user gets the default role. Core records the source in `registered_via` and audits `user_registered`.
- While self-registration is on, a deleted `oidc` or `external` user comes back as a new user at their next sign-in.
- User names are unique without regard to case. A name from the sign-up form or OIDC cannot contain `:`.
- The sign-up form gives one error for a taken name, and does not tell that the name exists.

| Source     | When                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `oidc`     | OIDC `autoProvision` is on and the allow policy accepts the identity (ADR-0008).                                                        |
| `external` | The external provider (ADR-0009) identifies a caller with no user.                                                                      |
| `signup`   | The "Create account" form on the sign-in page. It needs `localSignup` and local sign-in on. The budget for each IP of ADR-0008 applies. |

### Consequences

- Good, because a role never opens more than the endpoint level, and a user never sees what the role keeps from them.
- Good, because self-registration is off until an admin picks a default role.
- Bad, because a default role of Admin makes each new user an admin. ADR-0002 lists this risk.
- Bad, because a new endpoint is closed for each role until an admin opens it.

The model view `coreComponents` shows the auth components. The feature files `@id:roles`, `@id:my-instances`, `@id:own-credentials`, `@id:role-access` and `@id:self-registration` specify its behavior.
