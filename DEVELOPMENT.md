# Developing Synoikia

How to build, test and release Synoikia core. To contribute a change, also read [CONTRIBUTING.md](CONTRIBUTING.md). The design is in [`docs/adrs/`](docs/adrs/), [`docs/architecture/`](docs/architecture/README.md) and [`docs/reference.md`](docs/reference.md).

## Layout

| Path                        | What                                                                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`             | Core process ([Hono][hono], [SQLite][better-sqlite3] with [Drizzle][drizzle]): MCP listener (:8080), admin listener (:8081), plugin host, sandbox, permission gate, auth, notifications |
| `packages/core/src/testing` | `@synoikia/core/testing`: the plugin test harness, `startFakeHttp` and the compliance suite that plugin repositories test against                                                       |
| `packages/plugin-sdk`       | `@synoikia/plugin-sdk`: manifest schema, core ⇄ plugin RPC contract, `runPlugin()`, `definePlugin`, the `plugin.yaml` rules engine, HTTP/socket transports, OpenAPI and static catalogs |
| `packages/create-plugin`    | `@synoikia/create-plugin`: `pnpm create` / `pnpm new` scaffolding, plugin build and check, signed plugin repository release                                                             |
| `packages/admin-ui`         | [Vue 3][vue] admin portal (served by core on :8081)                                                                                                                                     |

## Setup

Requires [Node.js][node] 22 (≥ 22.14) or 24 and [pnpm][pnpm] 10 (`corepack enable`). `isolated-vm` has no build for other Node.js versions.

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

The git hooks in `.githooks/` come from NoVibe, with Synoikia `branch`, `keys` and `prose` guards. Before a commit they refuse credential files. Before a push they refuse a generated `claude/` branch name. They also check the commit phases, the feature files, the architecture model, the ADRs, added comments and the prose. The `Workflow` job (`.github/workflows/workflow.yml`) runs the same guards in CI. The `security-audit` job needs a `Security audit:` line in each ready pull request.

```sh
pnpm hooks:install        # once per clone: git runs .githooks before a commit and a push
```

Each guard says how to skip it once, for example `ALLOW_LINT=1 git push`.

Other useful commands:

```sh
pnpm --filter @synoikia/core exec vitest run test/gate.test.ts   # one test file
pnpm --filter @synoikia/core exec vitest run --project features   # core's feature files
pnpm --filter @synoikia/core test:coverage                        # enforces the coverage floors
```

## Feature files

All feature files are in `features/<domain>/` at the repository root. A domain is what the system does, so one domain can hold the feature files of several packages. The `features` project in each package's `vitest.config.ts` lists the domains and files that its World runs. The steps and the World of a package stay in `packages/<package>/features/`.

The `features` project of `packages/core/vitest.config.ts` runs core's feature files with Quickpickle in vitest. `packages/core/features/support/world.ts` gives each scenario a new World. It starts core on real listeners with a temporary data directory. It signs in a bootstrap admin on the Admin API and connects agents over MCP. The "Acme Tasks" fixture plugin calls a fake upstream. Steps use only these interfaces.

The portal's feature files are the `portal-*.feature` files of `features/instances/` and `features/plugins/`, and the domains that only the portal has. Their World builds the portal once and starts core with it for each scenario. Steps drive the portal in Chromium through Playwright, by roles, labels and visible text. CI installs Chromium with `pnpm --filter @synoikia/admin-ui exec playwright install --with-deps chromium`.

The plugin SDK's feature files are in `features/catalogs/`, `conformance/`, `manifest/`, `rules/`, `runtime/` and `upstream/`. Their World gives plugin author 3 a temporary plugin folder and a fake "Acme Tasks" upstream on a real listener. Steps use only the published API of `@synoikia/plugin-sdk`.

The feature files of `@synoikia/create-plugin` are in `features/build/`, `release/` and `scaffold/`. Their World runs the commands of its bins from the sources of this checkout, in a work folder of plugin author 3. A fake `gh` stands in for GitHub releases.

## Architecture model

The LikeC4 model in [`docs/architecture/`](docs/architecture/README.md) holds the structure of the system. NoVibe's `architect` skill says when a change updates it. An `arch:` commit changes only the model.

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

A release publishes the npm packages and the Docker image together. This keeps the plugin SDK and the test harness in step with the image that supports them. A merge to `main` publishes nothing.

| Artifact                  | Where it publishes                                                       |
| ------------------------- | ------------------------------------------------------------------------ |
| `@synoikia/plugin-sdk`    | npm                                                                      |
| `@synoikia/core`          | npm, for its plugin test harness                                         |
| `@synoikia/create-plugin` | npm                                                                      |
| The Docker image          | `ghcr.io/synoikia-org/synoikia:<version>`, and `latest` for a stable one |

Plugin repositories, [synoikia-core-plugins][core-plugins] included, build against the npm packages.

### The draft release

Each merge to `main` runs the Release draft workflow (`.github/workflows/release-draft.yml`). It creates or updates one draft release on GitHub:

- It finds the pull requests merged since the last published release, and the artifacts that each one changes.
- It computes the next version of each changed artifact from the pull request labels.
- It writes one section for each changed artifact, with its pull requests, and a block of the npm versions.

The release tag is `v<image version>`. The image version is the release version, so each release bumps it.

Before the first release, the last version change in each `package.json` marks what npm and GHCR already have. After it, the last published release marks it.

### Publish a release

1. Open the draft release on GitHub.
2. Read the sections. Edit the versions block or the tag if a version is wrong.
3. To publish a prerelease, set a tag such as `v0.24.0-rc.0`. Then select **Set as a pre-release**.
4. Select **Publish release**.

The Release workflow (`.github/workflows/release.yml`) then writes the versions into each `package.json` for the build. It does not commit them. It publishes each npm package whose version is not on npm yet. The order is the SDK, core, then create-plugin. It builds and pushes the image at the tag. A prerelease version goes to the `next` dist-tag on npm and does not move the `latest` image tag. The workflow adds npm provenance only while this repository is public, because npm rejects provenance from private repositories.

The workflow publishes through npm trusted publishing, so no token is stored. Each package's settings on npmjs.com trust `synoikia-org/synoikia-core` and `release.yml`, with **Direct publishing** allowed. If you rename the repository or the workflow file, update those settings too. Trusted publishing does not follow renames. npm can only trust a publisher for a package that already exists. So publish the first release of a new package once with a token or by hand, and then set its trusted publisher. npm's verbose log, on for each release run, says why npm refused a publish.

### Which versions a release bumps

Do not bump a `version` in a pull request. Label the pull request instead. The draft reads the labels when the pull request merges.

| Label      | Bump while at 0.x | Bump from 1.0 |
| ---------- | ----------------- | ------------- |
| `breaking` | minor             | major         |
| `feature`  | minor             | minor         |
| none       | patch             | patch         |

An artifact takes the largest bump of the pull requests that change it:

| Artifact                  | Changed by                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@synoikia/plugin-sdk`    | `packages/plugin-sdk/src` and its `package.json`                                                                                                                   |
| `@synoikia/core`          | `packages/core/src`, including `testing/`, `packages/core/drizzle` and its `package.json`                                                                          |
| `@synoikia/create-plugin` | its `src`, `templates` and `package.json`. Also a patch when core or the SDK takes a minor bump, because its `workspace:^` ranges are packed with the minor pinned |
| The Docker image          | the release: it takes the largest bump of all the artifacts                                                                                                        |

`scripts/release/plan.mjs` holds these rules. Docs-, test- and CI-only changes bump nothing. A breaking change to the SDK or to `@synoikia/core/testing` breaks every plugin repository, so call it out in the pull request.

<!-- External links -->

[core-plugins]: https://github.com/synoikia-org/synoikia-core-plugins
[vue]: https://vuejs.org/
[hono]: https://hono.dev/
[better-sqlite3]: https://github.com/WiseLibs/better-sqlite3
[drizzle]: https://orm.drizzle.team/
[drizzle-kit]: https://orm.drizzle.team/docs/kit-overview
[node]: https://nodejs.org/
[pnpm]: https://pnpm.io/
[vite]: https://vite.dev/
