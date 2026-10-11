# Developing Synoikia

How to build, test and release Synoikia core. To contribute a change, also read [CONTRIBUTING.md](CONTRIBUTING.md). The software design description is in [`docs/design/`](docs/design/README.md).

## Layout

| Path                        | What                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`             | Core process ([Hono][hono], [SQLite][better-sqlite3] with [Drizzle][drizzle]): MCP listener (:8080), admin listener (:8081), plugin host, sandbox, permission gate, auth, notifications |
| `packages/core/src/testing` | `@synoikia/core/testing`: the plugin test harness, `startFakeHttp` and `checkPluginContract` that plugin repositories test against                                                      |
| `packages/plugin-sdk`       | `@synoikia/plugin-sdk`: manifest schema, core ⇄ plugin RPC contract, `runPlugin()`, `definePlugin`, the `plugin.yaml` rules engine, HTTP/socket transports, OpenAPI and static catalogs |
| `packages/create-plugin`    | `@synoikia/create-plugin`: `pnpm create` / `pnpm new` scaffolding, plugin build and check, signed plugin repository release                                                             |
| `packages/admin-ui`         | [Vue 3][vue] admin portal (served by core on :8081)                                                                                                                                     |

## Setup

Requires [Node.js][node] 22 (≥ 22.12) or 24 and [pnpm][pnpm] 10 (`corepack enable`). `isolated-vm` has no build for other Node.js versions.

```sh
pnpm install
DATA_DIR=./data pnpm start   # MCP on :8080, admin on :8081; creates ./data/synoikia.sqlite + master.key
```

`pnpm start` runs the built output, so run `pnpm build` first.

Admin UI with hot reload: run `pnpm start` in one shell and `pnpm --filter @synoikia/admin-ui dev` in another. [Vite][vite] proxies `/api` and `/auth` to `:8081`.

## Checks

CI (`.github/workflows/ci.yml`) runs these, in this order, plus a Docker build:

```sh
pnpm lint
pnpm format:check   # pnpm format to fix
pnpm typecheck
pnpm build
pnpm test           # all packages; workspace deps resolve to TS sources, no build needed
```

Other useful commands:

```sh
pnpm --filter @synoikia/core exec vitest run test/gate.test.ts   # one test file
pnpm --filter @synoikia/core test:coverage                        # enforces the coverage floors
```

## Database schema changes

Edit `packages/core/src/db/schema.ts`, then run `pnpm --filter @synoikia/core db:generate` ([Drizzle Kit][drizzle-kit]). Migrations in `packages/core/drizzle/` apply on startup. Never edit `drizzle/meta/` by hand, and never change a migration that has shipped.

## Plugins

Plugins live in their own repositories, such as [synoikia-core-plugins][core-plugins]. Start one with `pnpm create @synoikia/plugin`; [docs/plugin-authoring.md](docs/plugin-authoring.md) covers the rest.

## Releases

### Publishing the npm packages

This repository publishes three npm packages: `@synoikia/plugin-sdk`, `@synoikia/core` (for its plugin test harness) and `@synoikia/create-plugin`. Plugin repositories, [synoikia-core-plugins][core-plugins] included, build against them. To release one, bump its `version` and merge to `main`. The Release workflow (`.github/workflows/release.yml`) publishes every package whose version isn't on npm yet: the SDK first, then core, then create-plugin. It adds provenance only while this repository is public, because npm rejects provenance from private repositories.

It publishes through npm trusted publishing, so no token is stored: each package's settings on npmjs.com trust `via-justa/synoikia-core` and `release.yml`, with **Direct publishing** allowed. If the repository or the workflow file is renamed, update those settings too; trusted publishing doesn't follow renames. npm can only trust a publisher for a package that already exists, so a new package's first release has to be published once with a token (or by hand) before its trusted publisher can be set.

Prerelease versions (`0.3.0-rc.0`) are never published by a merge. Publish them by hand with **Actions → Release → Run workflow**; they go to the `next` dist-tag, so `latest` stays on the last release. A prerelease run is also the way to check trusted publishing after changing its settings: npm's verbose log (on for every release run) says why a publish was refused.

### Publishing the Docker image

The Docker image ships as one unit (core + admin UI, with the SDK only as a build dependency), so it carries its own version in the root `package.json`, separate from the package versions above. To release a new image, bump that `version` and merge to `main`; the same `release.yml` builds and pushes `ghcr.io/via-justa/synoikia:<version>` (and moves `latest` to it, for stable versions) whenever that tag isn't already published. Prereleases follow the same manual-dispatch rule as the npm packages.

Which versions a change bumps is set in [CLAUDE.md](CLAUDE.md) › Releases.

<!-- External links -->

[core-plugins]: https://github.com/via-justa/synoikia-core-plugins
[vue]: https://vuejs.org/
[hono]: https://hono.dev/
[better-sqlite3]: https://github.com/WiseLibs/better-sqlite3
[drizzle]: https://orm.drizzle.team/
[drizzle-kit]: https://orm.drizzle.team/docs/kit-overview
[node]: https://nodejs.org/
[pnpm]: https://pnpm.io/
[vite]: https://vite.dev/
