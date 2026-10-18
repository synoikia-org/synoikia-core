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

CI (`.github/workflows/ci.yml`) runs the same commands, plus a Docker build. The `check` job runs the checks and the build. The `features` job splits core's scenarios across four runners. The `e2e-ui` job runs the portal's scenarios in Chromium. The `test` job runs every other test. Locally, run them in this order:

```sh
pnpm lint
pnpm format:check   # pnpm format to fix
pnpm typecheck
pnpm build
pnpm test           # all packages; workspace deps resolve to TS sources, no build needed
```

The whole core suite takes about three minutes. While you work, run only the feature folders you change. Run the whole suite before you push, or let CI run it.

```sh
pnpm --filter @synoikia/core test:features features/identity                 # one folder
pnpm --filter @synoikia/core test:features features/identity features/approvals   # several folders
pnpm --filter @synoikia/admin-ui test:features                              # the portal in Chromium, against a real core
pnpm --filter @synoikia/plugin-sdk test:features                            # the plugin SDK, as a plugin author uses it
pnpm --filter @synoikia/create-plugin test:features                         # the plugin tool, run as commands by a plugin author
```

The `Workflow` job (`.github/workflows/workflow.yml`) checks the rules in [docs/workflow.md](docs/workflow.md). Run the same checks locally, or let the git hooks run them:

```sh
pnpm hooks:install        # once per clone: .githooks runs the checks before a commit and a push
pnpm workflow pre-push    # branch name, commit phases, feature files and prose since origin/main
```

Other useful commands:

```sh
pnpm --filter @synoikia/core exec vitest run test/gate.test.ts   # one test file
pnpm --filter @synoikia/core exec vitest run --project features   # core's feature files
pnpm --filter @synoikia/core test:coverage                        # enforces the coverage floors
```

## Feature files

Core's feature files are in `packages/core/features/`. Quickpickle runs them in vitest, in the `features` project of `packages/core/vitest.config.ts`. `features/support/world.ts` gives each scenario a new World. It starts core on real listeners with a temporary data directory. It signs in a bootstrap admin on the Admin API and connects agents over MCP. The "Acme Tasks" fixture plugin calls a fake upstream. Steps use only these interfaces.

The portal's feature files are in `packages/admin-ui/features/`. Their World builds the portal once and starts core with it for each scenario. Steps drive the portal in Chromium through Playwright, by roles, labels and visible text. CI installs Chromium with `pnpm --filter @synoikia/admin-ui exec playwright install --with-deps chromium`.

The plugin SDK's feature files are in `packages/plugin-sdk/features/`. Their World gives plugin author 3 a temporary plugin folder and a fake "Acme Tasks" upstream on a real listener. Steps use only the published API of `@synoikia/plugin-sdk`.

## Architecture model

The LikeC4 model in [`docs/architecture/`](docs/architecture/README.md) holds the structure of the system. The `architect` skill and `docs/workflow.md` say when a change updates it. An `arch:` commit changes only the model.

```sh
pnpm arch:serve    # preview the views locally
pnpm arch:check    # validate the model
pnpm arch:export   # write docs/architecture/README.md after you change the model
```

CI fails when the committed `README.md` does not match the model.

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
