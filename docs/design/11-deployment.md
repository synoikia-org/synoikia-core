# §11 Deployment

## Image

- One image, built in stages:
  1. `pnpm install --frozen-lockfile`
  2. Build the SDK, then core, then the admin UI.
  3. The runtime stage is `node:22-bookworm-slim` with the production `node_modules` (native: `better-sqlite3`, `isolated-vm`, `argon2`), `packages/core/dist` and the admin UI `dist`.
- The image has no plugins. Core installs plugins into the data volume.
- The image is `ghcr.io/via-justa/synoikia`, for `linux/amd64` and `linux/arm64`. Its tag is the `version` of the root `package.json`. This version is separate from the package versions. `latest` is the newest stable release.
- `.github/workflows/release.yml` builds and pushes the image when a version change merges to `main`. Prereleases are published by hand only.
- The container runs as a user that is not root. `DATA_DIR=/data` is a volume. Ports 8080 and 8081 are exposed. `HEALTHCHECK` calls `:8080/healthz`.

## Health

`/healthz` on each listener needs no authentication. Both return only `{"status": "ok"}`. The details of each instance are only in `/api/overview` on the Admin listener.

Scenarios: [`@id:listeners`](../../packages/core/features/deployment/listeners.feature).

## Reverse proxy

- `mcp.example.com` → `:8080`. The proxy must pass `Mcp-Session-Id`, allow SSE (no buffering), and forward `X-Forwarded-Proto` and `Host`.
- `admin.example.com` → `:8081`. The admin portal runs on this dedicated port, separate from the MCP port. The portal sign-in protects it (§6.1). Cloudflare Access or Authelia can add a second layer.
- `TRUST_PROXY=true`, or a number of proxies (for example `2`), makes core use `X-Forwarded-*`. Core then takes the client IP (for rate limits and audit), the scheme and the cookie `Secure` flag from these headers.
- Core reads `X-Forwarded-For` from the right. The entry that the outermost trusted proxy added is the client. Core ignores the entries to its left, because the client sent them.

Scenarios: [`@id:proxies`](../../packages/core/features/deployment/proxies.feature), [`@id:host-origin`](../../packages/core/features/deployment/host-origin.feature).

## Environment

The full list is in `.env.example`: `DATA_DIR`, `MASTER_KEY`, `MCP_HOST`, `MCP_PORT`, `ADMIN_HOST`, `ADMIN_PORT`, `PUBLIC_MCP_URL`, `PUBLIC_ADMIN_URL`, `MCP_ALLOWED_HOSTS`, `TRUST_PROXY`, `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_PASSWORD`, `ADMIN_FORCE_LOCAL_LOGIN`, `LOG_LEVEL`.

## Server log

Core writes one `LEVEL message key=value` line for each event to stdout or stderr, filtered by `LOG_LEVEL`.

- **Refused MCP requests.** Core logs the reason, for example the auth methods and the kind of credential, or the client name (§6.6). The client never gets the reason. The log never holds a credential value.
- The reason is a quoted and shortened field, because it can quote claims that are not verified.
- **Throttle.** Core logs one refusal for each client IP and status in each minute. The next line gives the number of lines it did not write.
- Request lines hold the path only, because query strings hold OAuth state.
- A proxy in front of core (for example Cloudflare Access) logs its own refusals. They never reach core.

Scenarios: [`@id:server-log`](../../packages/core/features/deployment/server-log.feature).

## Network egress

Use a container network policy. Allow outbound traffic only to the upstream hosts, the ntfy and webhook targets, the OIDC issuer, and the plugin repository hosts. Core does not restrict the network access of plugins (§4.4).
