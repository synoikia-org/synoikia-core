---
status: accepted
date: 2026-10-15
---

# Two listeners, and a guarded MCP edge

## Context and Problem Statement

MCP clients reach core from the internet. The admin portal changes every security setting and must stay on the LAN. A browser on the internet can also reach the MCP listener, and text from a plugin reaches the model. How does core split these surfaces, and what guards the MCP edge?

## Decision Drivers

- A route of the admin portal must not exist where the internet can reach it.
- A session for one purpose must not work for another.
- Core must not trust the `Host` header for anything that a client can turn against it.
- Plugin text in the MCP instructions must not read as core's own rules.

## Considered Options

- Two Hono apps on two ports, separate cookies for each purpose on the MCP listener, a host check, and plugin text in a delimited block.
- One listener with path rules, behind a proxy that hides the admin paths.

## Decision Outcome

Chosen option: "Two Hono apps on two ports". A proxy publishes only the MCP port, and a route of one listener does not exist on the other.

For example, `GET :8080/api/instances` and `GET :8081/{slug}` both return 404.

| Listener | Default        | Variables                  | Serves                                                                                               |
| -------- | -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| MCP      | `0.0.0.0:8080` | `MCP_HOST`, `MCP_PORT`     | MCP endpoints, OAuth server and metadata, OAuth sign-in and consent pages, approval page, `/healthz` |
| Admin    | `0.0.0.0:8081` | `ADMIN_HOST`, `ADMIN_PORT` | Admin SPA, Admin API, admin sign-in, OIDC callback, `/healthz`                                       |

**Public URLs.** `PUBLIC_MCP_URL` is the public address of the MCP listener, for example `https://mcp.example.com`.

- OAuth needs it. It is the issuer and the resource base in OAuth metadata, and approval-page links start with it.
- If it is not set, OAuth is off. OAuth routes and metadata return 503, and core does not accept OAuth tokens. The Overview page shows a warning. Bearer tokens continue to work.
- Core never takes the issuer from the `Host` header of a request, because the client controls it.
- Only the approval-page link, which goes back to the same client, uses the request origin when `PUBLIC_MCP_URL` is not set.
- `PUBLIC_ADMIN_URL` is optional. Core uses it for OIDC redirect URIs and for links in notifications.

**Pages on the MCP listener.** The MCP listener shows a small fixed set of HTML pages: OAuth sign-in, OAuth consent, and the approval page. They use the portal user accounts and the OIDC configuration.

- The pages run no scripts. The only exception is the page after an approval decision: its CSP allows one static `window.close()` script by its hash (ADR-0006).
- Each purpose has its own cookie. These sessions are short, and the Admin API does not accept them.
- A consent session cannot decide approvals. An approval session cannot authorize clients.

| Purpose  | Cookie            | Path     | Session kind  |
| -------- | ----------------- | -------- | ------------- |
| Consent  | `syn_mcp_oauth`   | `/oauth` | `oauth_ui`    |
| Approval | `syn_mcp_approve` | `/a`     | `approval_ui` |

**Endpoint routing.**

- `/{slug}` is the Streamable HTTP endpoint of one instance. `POST` sends JSON-RPC, `GET` opens the SSE stream, and `DELETE` ends the session.
- A slug matches `^[a-z0-9][a-z0-9-]{0,62}$` and is unique. These words are reserved: `oauth`, `a`, `healthz`, `.well-known`, `api`, `auth`, `static`.
- **DNS-rebinding defence.** The `Host` header must be the host of `PUBLIC_MCP_URL`, a name in `MCP_ALLOWED_HOSTS`, `localhost`, or an IP address. Otherwise core returns 403. A browser `Origin` must be in the same set.
- Authentication comes first (ADR-0009). Then an unknown slug returns 404.
- A disabled instance, or an instance of a disabled plugin, returns 503 with the JSON-RPC error "This instance is unavailable".
- Each instance has its own `McpServer` with `search`, `execute` and `resume`, and the approval card (ADR-0006). The tool descriptions come from the plugin manifest, for example `acme.call(...)`.
- Core keys MCP sessions by instance and `Mcp-Session-Id`. A session records the principal and whether the client supports elicitation. A parked execution does not belong to a session.
- A principal can have 16 open MCP sessions on each endpoint. A new session closes the least recently used one of that principal on that endpoint. A principal can have 64 open MCP sessions in total. Past that, a new session closes the least recently used one of that principal on any endpoint.

**Agent instructions.** The server `instructions` start with a fixed core text: the plugin name, and how to use `search`, `execute` and `resume`.

- If the plugin has an instructions file (ADR-0011), core adds its text in a `<plugin-notes plugin="<id>">` block after the core text. The block states that the text does not change what core allows.
- After the block, core repeats its approval rule, so the core text comes first and last.
- Core adds the same block and rule to the `search` tool description, because some clients do not show server instructions to the model.
- Core sends the text as plain text. It applies no templates.

### Consequences

- Good, because the admin portal is not on the internet unless an admin publishes its port.
- Good, because a stolen consent or approval cookie cannot reach the Admin API or the other purpose.
- Good, because a rebinding page cannot reach the MCP listener through another host name.
- Bad, because an install without `PUBLIC_MCP_URL` has no OAuth.
- Bad, because plugin text still reaches the model. The block marks it, and core's rules come before and after it.

The model views `containers` and `deployment` show the listeners. The feature files `@id:listeners`, `@id:host-origin` and `@id:proxies` specify its behavior.
