<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/synoikia-lockup-dark.svg" />
    <img src="docs/assets/synoikia-lockup-light.svg" alt="Synoikia" height="72" />
  </picture>
</p>

<p align="center">
  <strong>Many MCP servers, one roof.</strong><br />
  One control plane for your self-hosted MCP servers: every service behind a single MCP server, one admin portal and one permission gate.
</p>

<p align="center">
  <a href="#why-synoikia">Why</a> ·
  <a href="#core-features">Core features</a> ·
  <a href="#the-name">The name</a> ·
  <a href="#deployment">Deployment</a> ·
  <a href="DEVELOPMENT.md">Development</a> ·
  <a href="docs/adrs/">Decision records</a> ·
  <a href="#contributing">Contributing</a>
</p>

> [!WARNING]
> This tool is in early development. Expect breaking changes, missing features, and bugs. It is not yet recommended for production use.

---

Synoikia replaces a handful of separately deployed [MCP][mcp] servers with one, extended by plugins. Each plugin instance gets its own MCP endpoint, and every call from a model passes through the same sandbox, access levels and human approvals:

```
https://mcp.example.com/nas     → NAS plugin
https://mcp.example.com/media   → media server plugin
https://mcp.example.com/home    → home automation plugin
https://admin.example.com       → Admin portal (runs on its own dedicated port, login required)
```

## The name

_Synoikia_ (Greek συνοικία; pronounced si.niˈci.a) comes from _syn_ (σύν, "together") and _oikos_ (οἶκος, "house"): households living together. It shares its root with _synoikismos_, or [synoecism](https://en.wikipedia.org/wiki/Synoecism), the ancient Greek practice of joining separate villages into a single city. Athens traced its own founding to one, and marked it every year with a festival called the Synoikia.

That is what this project does for your MCP servers: services that used to run scattered, each with its own deployment and its own rules, now live under one roof and answer to one household.

## Why Synoikia

Synoikia grew out of running several MCP servers next to each other and hitting the same two problems with every one of them.

### 1. Tool definitions eat the context window

A typical MCP server exposes one [tool][mcp-tools] per operation, and every tool's name, description and schema is loaded into the model's context at the start of every session, whether it is used or not. The more of the API a server covers, the more it costs, so servers end up hand-curating a small subset and still paying tens of thousands of tokens for it.

Synoikia uses the [**Code Mode**][code-mode] pattern instead: each endpoint exposes three small tools. The model calls `search(code)` to find only the operations and schemas it needs for the task, then `execute(code)` to call them, and `resume` to pick up a call that waited for your approval. The full catalog never enters the context, so the cost stays flat however large the upstream API is.

A few examples:

| Integration    | Classic MCP server                         | Context cost    | With Synoikia (3 tools)     |
| -------------- | ------------------------------------------ | --------------- | --------------------------- |
| TrueNAS        | 52 hand-picked tools                       | ~15–20K tokens  | ~1–3K, all ~650–700 methods |
| Home Assistant | 65 curated tools, growing with each domain | ~45–60K+ tokens | ~1–3K, every service        |

### 2. Every MCP server has its own idea of safety

Each server makes its own security decisions, and they rarely agree: some run every write immediately, some ask for approval through a prompt the calling client can answer itself, and some ship a raw "send any command" escape hatch. Authentication, secret handling and logging differ from server to server, and a destructive call such as wiping a disk or deleting a dataset is only as safe as the least careful implementation. Running them side by side also means separate processes, portals, databases and logins to keep secure.

Synoikia implements the security-critical parts **once, in core**, and applies them to every plugin: the sandbox, access levels, human approvals that the calling client can't give itself, redaction, the audit log and authentication. A plugin only describes its upstream API; it never decides what is allowed.

## Core features

**🔌 One server, many MCP servers.** Each MCP server is a plugin, installed from a plugin repository and verified with [minisign][minisign] signatures. The [Synoikia plugins repository][core-plugins] comes pre-configured with a set of plugins, and you can add your own. To try an unreleased build on a live server, an admin can upload its tarball over the installed plugin and revert to the released version later. Run several instances of the same plugin (e.g., nas-prod, nas-staging), each on its own endpoint.

**🧰 Three tools per endpoint.** Every endpoint exposes just `search(code)`, `execute(code)` and `resume`. The model discovers operations and calls them with code that runs inside an [`isolated-vm`][isolated-vm] sandbox with no Node APIs, network or timers.

**🛂 A permission gate on every call.** Each operation has an access level, set per group with per-operation exceptions. New groups start at Ask. Whether an operation reads or writes comes from the upstream API, not from a guess:

| Level     | Behaviour                                                                   |
| --------- | --------------------------------------------------------------------------- |
| **None**  | Hidden from the model                                                       |
| **Read**  | Reads only                                                                  |
| **Ask**   | Writes wait for a human approval, unless a narrow pre-approval rule matches |
| **Write** | Writes run without asking, once acknowledged                                |

An operation's own level only offers what fits it: a read is None, Read or Ask (every call asks), a write None, Ask or Write.

**✋ Human-in-the-loop (HITL) the model can't fake.** You approve on Synoikia's own approval page, where you sign in once per browser (or Cloudflare Access identifies you). Clients that support [URL-mode elicitation][elicitation] open it for you; in chat clients such as Claude or ChatGPT, an approval card appears in the conversation and the chat continues by itself after you decide. The client that made the call can't approve it, unless you let an endpoint approve its Ask calls in the agent session: then a form prompt in the client or Approve/Deny on the card decides, and locked operations still need the page. "Approve for this session" lets one client run its Ask operations on one endpoint without asking, for a few hours (useful for batch operations). Destructive operations are `locked` by default: off until you set them to Ask, and then they always need a human and a typed confirmation, and can never be pre-approved or set to Write.

**🔐 Per-client ceilings.** Each connected client gets an access ceiling when you connect it (OAuth consent) or create its token: read only by default. MCP clients authenticate with [OAuth 2.1][oauth], bearer tokens or [Cloudflare Access][cf-access]; you choose which methods are on, globally and per endpoint. An allow or deny list of client names keeps clients you don't want off the server (a client declares its own name, so this is not authentication).

**🧱 Isolated plugins.** Every plugin instance runs in its own child process under the [Node permission model][node-perm], with a scrubbed environment and a memory cap. Secrets are encrypted at rest and handed only to the instance that owns them.

**🙈 Secrets stay out of the transcript.** Passwords, tokens and keys are redacted from results, logs, approvals and the audit trail, including each instance's actual secret values wherever they appear in text.

**📜 Audit log and notifications.** Every call, decision and admin change is audited and exportable. Optional [ntfy][ntfy] and signed-webhook notifications tell you when something needs you.

**🖥️ An admin portal.** A separate, login-protected port with local accounts, [TOTP][totp] and [OIDC][oidc] single sign-on, for endpoints, access levels, pre-approval rules, clients, plugins and settings.

**🔄 Self-maintaining catalogs.** Each instance re-syncs its operation catalog when the upstream version changes, before serving anything from a newly installed plugin version, and on a daily schedule, and keeps serving the last good catalog if the upstream is briefly unreachable.

## Development

Repository layout, local setup, the checks CI runs and how releases are published are in [DEVELOPMENT.md](DEVELOPMENT.md). To write a plugin, see [docs/plugin-authoring.md](docs/plugin-authoring.md).

## Deployment

```sh
cp .env.example .env   # set MASTER_KEY, PUBLIC_MCP_URL, …
docker compose -f docker-compose.example.yml up -d
```

Pulls the published image from `ghcr.io/synoikia-org/synoikia`. `latest` tracks the newest stable release. Pin an explicit version tag (e.g. `ghcr.io/synoikia-org/synoikia:0.2.0`) in production. Deploys with [Docker Compose][compose]. Put `:8080` behind your reverse proxy (such as [Caddy][caddy], [Traefik][traefik] or a [Cloudflare Tunnel][cf-tunnel]) as the public MCP hostname and set `PUBLIC_MCP_URL` to it. The admin portal runs on its own dedicated port (`ADMIN_PORT`, 8081 by default). See [Reverse proxy](#reverse-proxy) and ADR-0015.

On first start, open the admin portal and create the first account (or set `ADMIN_BOOTSTRAP_USERNAME`/`ADMIN_BOOTSTRAP_PASSWORD` once). Then install and enable plugins, create an endpoint, raise the access groups you want above Read, and connect your MCP client to `PUBLIC_MCP_URL/<slug>`.

### Reverse proxy

- `mcp.example.com` → `:8080`. The proxy must pass `Mcp-Session-Id`, allow SSE without buffering, and forward `X-Forwarded-Proto` and `Host`.
- `admin.example.com` → `:8081`. The admin portal has its own port, and its sign-in protects it. An access proxy, such as Cloudflare Access, can add a second layer.
- Set `TRUST_PROXY=true`, or the number of proxies, so that core reads `X-Forwarded-*`. Core reads `X-Forwarded-For` from the right, and takes the entry that the outermost trusted proxy added as the client.

### Metrics

Set `METRICS_PORT` to let Prometheus read the metrics of core at `/metrics` on that port. Set `METRICS_TOKEN` too, and give Prometheus the same value as its bearer token. Without `METRICS_TOKEN`, anyone who can reach the port can read the metrics, and core logs a warning at start. Keep the port on the LAN. The port has no Host check, so set `METRICS_TOKEN` where browsers share the network. See ADR-0023.

```yaml
scrape_configs:
  - job_name: synoikia
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['synoikia.lan:9464']
```

### Network egress

Core does not restrict the network access of plugins yet (issues #108 and #111). Use a container network policy. Allow outbound traffic only to the upstream hosts, the ntfy and webhook targets, the OIDC issuer and the plugin repository hosts.

### Debugging a client that can't connect

Core logs each refused MCP request with its reason. The reason can be the endpoint's client auth methods or the kind of credential the client sent. It can also be a Cloudflare Access claim that didn't match, a Host outside `PUBLIC_MCP_URL`/`MCP_ALLOWED_HOSTS`, or an endpoint that is unavailable. Watch `docker compose logs -f synoikia` while the client connects. Set `LOG_LEVEL=debug` to also see every request on the MCP port, including OAuth discovery. If nothing shows up, the request was stopped before it reached Synoikia: check your proxy's log (for Cloudflare Access, Zero Trust → Logs → Access). The server log is in [`docs/reference.md`](docs/reference.md#server-log).

### Plugin repositories

On first start Synoikia adds the [Synoikia plugins repository][core-plugins] with its signing key pinned:

- index: `https://github.com/synoikia-org/synoikia-core-plugins/releases/download/index/index.json`
- public key: `RWSDbQe7ylyyieEU0Yh/bxR53m+N/0VrVMru5WCzv1/Yvt5td92t/21e`

Install plugins from it on the Plugins page; every download is checked against that key. Removing the repository is permanent: it isn't added again on the next start. To add it back, add it as a signed repository with the URL and key above. Other repositories are added the same way, signed with their publisher's key or unsigned.

### Rotating the master key

Stop the server, then:

```sh
docker compose -f docker-compose.example.yml stop
# key file in the data volume: a new key is generated and written for you
docker compose -f docker-compose.example.yml run --rm synoikia node packages/core/dist/cli.js rotate-master-key
# MASTER_KEY from the environment: create the replacement first and keep it — it is the only copy
NEW_KEY="$(openssl rand -base64 32)"; echo "$NEW_KEY"
docker compose -f docker-compose.example.yml run --rm -e NEW_MASTER_KEY="$NEW_KEY" synoikia node packages/core/dist/cli.js rotate-master-key
# then set MASTER_KEY=$NEW_KEY in .env and start the server again
```

Every session is signed out afterwards.

## Contributing

Bug reports, feature requests and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and what CI checks before merge. Everyone participating is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security issue? Please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

[MIT](LICENSE)

<!-- External links -->

[core-plugins]: https://github.com/synoikia-org/synoikia-core-plugins
[mcp]: https://modelcontextprotocol.io/
[mcp-tools]: https://modelcontextprotocol.io/specification/2025-11-25/server/tools
[elicitation]: https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation
[code-mode]: https://blog.cloudflare.com/code-mode/
[isolated-vm]: https://github.com/laverdet/isolated-vm
[minisign]: https://jedisct1.github.io/minisign/
[oauth]: https://oauth.net/2.1/
[cf-access]: https://www.cloudflare.com/zero-trust/products/access/
[node-perm]: https://nodejs.org/api/permissions.html
[ntfy]: https://ntfy.sh/
[totp]: https://datatracker.ietf.org/doc/html/rfc6238
[oidc]: https://openid.net/developers/how-connect-works/
[compose]: https://docs.docker.com/compose/
[caddy]: https://caddyserver.com/
[traefik]: https://traefik.io/traefik/
[cf-tunnel]: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
