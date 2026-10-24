# Deployment

This guide is for the operator who runs Synoikia core. Every environment variable is in [`.env.example`](../.env.example) and in [`docs/reference.md`](reference.md#environment) › Environment.

## Run the image

```sh
cp .env.example .env   # set MASTER_KEY, PUBLIC_MCP_URL, …
docker compose -f docker-compose.example.yml up -d
```

[Docker Compose](https://docs.docker.com/compose/) pulls the image from `ghcr.io/synoikia-org/synoikia`. The `latest` tag follows the newest stable release. In production, pin a version tag, such as `ghcr.io/synoikia-org/synoikia:0.2.0`.

Core listens on two ports ([ADR-0015](adrs/0015-two-listeners.md)):

| Port   | Variable     | What                                   |
| ------ | ------------ | -------------------------------------- |
| `8080` | `MCP_PORT`   | The MCP endpoints for agents           |
| `8081` | `ADMIN_PORT` | The admin portal, with its own sign-in |

## First start

1. Open the admin portal and make the first account. It gets the Admin role. A server without a browser can set `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD` once instead.
2. Install and enable plugins.
3. Make an instance, and raise the access groups that you want above Read.
4. Connect your MCP client to `PUBLIC_MCP_URL/<slug>`.

## Reverse proxy

Put the agent port behind a reverse proxy, such as [Caddy](https://caddyserver.com/), [Traefik](https://traefik.io/traefik/) or a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). Set `PUBLIC_MCP_URL` to its public address.

- `mcp.example.com` → `:8080`. The proxy must pass `Mcp-Session-Id` and allow SSE without buffering. It must forward `X-Forwarded-Proto` and `Host`.
- `admin.example.com` → `:8081`. The sign-in of the portal protects it. An access proxy, such as Cloudflare Access, can add a second layer.
- Set `TRUST_PROXY=true`, or the number of proxies, so that core reads `X-Forwarded-*`. Core reads `X-Forwarded-For` from the right. It takes the entry that the outermost trusted proxy added as the client.

## Metrics

Set `METRICS_PORT` to let Prometheus read the metrics of core at `/metrics` on that port ([ADR-0024](adrs/0024-metrics-listener.md)). Also set `METRICS_TOKEN`, and give Prometheus the same value as its bearer token. Without `METRICS_TOKEN`, anyone who can reach the port can read the metrics, and core logs a warning at start. Keep the port on the LAN. The port has no Host check, so set `METRICS_TOKEN` where browsers share the network.

```yaml
scrape_configs:
  - job_name: synoikia
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['synoikia.lan:9464']
```

| Metric                                  | Labels                | What                                                              |
| --------------------------------------- | --------------------- | ----------------------------------------------------------------- |
| `synoikia_build_info`                   | `version`             | The version of core                                               |
| `synoikia_calls_total`                  | `instance`, `outcome` | Calls by outcome: `done`, `denied`, `failed`, `awaiting_approval` |
| `synoikia_call_duration_seconds`        | `instance`            | How long calls take to answer                                     |
| `synoikia_approvals_total`              | `instance`, `outcome` | Approvals by how they end: `approved`, `denied`, `timed_out`      |
| `synoikia_agent_sign_in_failures_total` |                       | Agent requests refused for their credential                       |
| `synoikia_active_users`                 |                       | Users with a call in the last hour                                |
| `synoikia_plugins_installed`            |                       | Installed plugins                                                 |
| `synoikia_instances`                    |                       | Configured instances                                              |
| `synoikia_instance_state`               | `instance`, `state`   | 1 for the current state of each instance                          |
| `synoikia_sessions_open`                | `instance`            | Open agent sessions                                               |
| `synoikia_sessions_by_app`              | `app`                 | Open agent sessions by the app that the client names              |

Counters start at zero when core starts. A call that waits for approval counts once as `awaiting_approval`, and again when it ends. Its duration then includes the wait. The app name comes from the client, so any client can claim any name.

## Network egress

Core does not restrict the network access of plugins yet. Issues #108 and #111 track it. Use a container network policy. Allow outbound traffic only to these hosts:

- The upstream hosts of your instances
- The ntfy and webhook targets
- The OIDC issuer
- The hosts of the plugin repositories

## Plugin repositories

At the first start, core adds the [Synoikia plugins repository](https://github.com/synoikia-org/synoikia-core-plugins) with its signing key pinned:

- Index: `https://github.com/synoikia-org/synoikia-core-plugins/releases/download/index/index.json`
- Public key: `RWSDbQe7ylyyieEU0Yh/bxR53m+N/0VrVMru5WCzv1/Yvt5td92t/21e`

Install plugins from it on the Plugins page. Core checks each download against that key. When you remove the repository, core does not add it again at the next start. To add it back, add it as a signed repository with the URL and the key above. Add other repositories the same way: signed with the key of their publisher, or unsigned.

## Rotate the master key

1. Stop the server:

   ```sh
   docker compose -f docker-compose.example.yml stop
   ```

2. Rotate the key. With the key file in the data volume, the command makes a new key and writes it for you:

   ```sh
   docker compose -f docker-compose.example.yml run --rm synoikia node packages/core/dist/cli.js rotate-master-key
   ```

   With `MASTER_KEY` in the environment, make the new key first and keep it. It is the only copy:

   ```sh
   NEW_KEY="$(openssl rand -base64 32)"; echo "$NEW_KEY"
   docker compose -f docker-compose.example.yml run --rm -e NEW_MASTER_KEY="$NEW_KEY" synoikia node packages/core/dist/cli.js rotate-master-key
   ```

   Then set `MASTER_KEY` to the new key in `.env`.

3. Start the server. Every session is signed out.

## A client that cannot connect

Core logs each refused MCP request with its reason ([`docs/reference.md`](reference.md#server-log) › Server log). These are the usual reasons:

- The client auth methods of the endpoint
- The kind of credential that the client sent
- A Cloudflare Access claim that did not match
- A Host outside `PUBLIC_MCP_URL` or `MCP_ALLOWED_HOSTS`
- An endpoint that is not available

Watch `docker compose logs -f synoikia` while the client connects. Set `LOG_LEVEL=debug` to also see each request on the MCP port, OAuth discovery included. If nothing shows, the request stopped before it reached core. Look in the log of your proxy. For Cloudflare Access, that is Zero Trust › Logs › Access.
