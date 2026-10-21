# Synoikia core

One MCP server for many self-hosted services. Each plugin instance gets its own endpoint exposing `search(code)`, `execute(code)` and `resume(executionId)` (for a call parked on an approval). Every call goes through one sandbox, permission gate, approval flow, redaction and audit log. The security decisions are ADRs in `docs/adrs/`, and the behavior is the feature files in `features/`. The structure is the LikeC4 model in `docs/architecture/`, and other facts are in `docs/reference.md`. Code comments cite an ADR (`ADR-0003`) or a feature `@id`.

[NoVibe](https://github.com/novibe-org/novibe) runs the workflow: its `novibe` plugin and its git hooks in `.githooks/`. The Synoikia skills, rules, agent and hooks come from the `synoikia-core-dev` plugin of the [Synoikia dev kit](https://github.com/synoikia-org/synoikia-dev-kit). `.claude/settings.json` enables both plugins, and a session start hook says when they are not loaded. This repository needs them. `.claude/guard-paths.json` lists the files that the path guard protects.

## Layout

| Path                        | What                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`             | Server: MCP endpoints, admin API, gate, sandbox, plugin host, SQLite (Drizzle)                                                                                                                                     |
| `packages/plugin-sdk`       | Manifest schema, core ⇄ plugin RPC contract, `runPlugin()`, and what plugins are built from: `definePlugin`, the `plugin.yaml` rules engine, HTTP/socket transports, OpenAPI and static catalogs. Published to npm |
| `packages/create-plugin`    | `@synoikia/create-plugin`: `pnpm create`/`pnpm new` scaffolding, plugin build/check, signed repository release. Published to npm                                                                                   |
| `packages/admin-ui`         | Admin portal: Vue 3, Pinia, Vite                                                                                                                                                                                   |
| `.github/actions/prose`     | The writing rule checker: a GitHub Action for CI here and in plugin repos, and the `prose` git hook                                                                                                                |
| `packages/core/src/testing` | `@synoikia/core/testing`: the plugin harness, `startFakeHttp` and the compliance suite plugin repos test against. Published API                                                                                    |

Local setup, checks and releases: `DEVELOPMENT.md`. Plugin authoring: `docs/plugin-authoring.md`. The design: `docs/adrs/`, `docs/architecture/` and `docs/reference.md`. The plugins live in `synoikia-org/synoikia-core-plugins`.

## Commands

Node 22.12+ or 24 (`.nvmrc` pins 22), pnpm 10.

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm test   # what CI runs, in that order
pnpm --filter @synoikia/core exec vitest run test/gate.test.ts                # one test file
pnpm --filter @synoikia/core test:features features/identity               # one feature folder (the whole suite takes ~3 min)
pnpm --filter @synoikia/core test:coverage                                      # enforces coverage floors
pnpm format                                                                     # fix formatting
pnpm hooks:install                                                              # once per clone: the git hooks in .githooks
```

## Conventions

Do not add `Co-Authored-By` or `Claude-Session` trailers to commit messages, and no "Generated with Claude Code" line to pull request descriptions.
