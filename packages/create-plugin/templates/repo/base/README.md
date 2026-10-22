# {{repoName}}

Plugins for [Synoikia](https://github.com/synoikia-org/synoikia-core), the self-hosted MCP control plane.

A plugin only describes its upstream API: its operations, which ones read or write, which are destructive, and which fields hold secrets. Synoikia's core decides what is allowed and runs every call through its sandbox, permission gate, approvals, redaction and audit log. See the [plugin authoring guide](https://github.com/synoikia-org/synoikia-core/blob/main/docs/plugin-authoring.md).

## Layout

| Path                         | What                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `plugins/<id>/manifest.json` | Binding, connection form, `sensitiveKeys`, network hosts                                  |
| `plugins/<id>/plugin.yaml`   | What the plugin tells core about its operations: locks, splits, secrets, confirm literals |
| `plugins/<id>/src/`          | Discovery, auth and anything that needs logic                                             |
| `plugins/<id>/test/`         | `compliance.yaml` (the compliance profile), a fake upstream, and unit tests in `unit/`    |
| `plugins/<id>/features/`     | `<id>.feature`: plugin-specific behavior, written with the compliance suite's steps       |
| `tsconfig.base.json`         | Shared compiler options. Each plugin's `tsconfig.json` extends it                         |
| `vitest.shared.ts`           | Shared Vitest config. Each plugin's `vitest.config.ts` builds on it                       |

Plugins build against Synoikia's published npm packages:

- `@synoikia/plugin-sdk`: the manifest schema, RPC contract and `runPlugin()` runtime. The bundle includes it.
- `@synoikia/create-plugin` (dev only): `synoikia-plugin new`, `build`, `check` and the `repo` release steps.
- `@synoikia/core` (dev only): `@synoikia/core/testing/compliance` is core's compliance suite. It boots the real core on the built bundle as a permission-confined child, as in production. Then it drives the plugin against its own fake upstream.

## Development

Requires Node ≥ 22.12 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm new          # add a plugin
pnpm test         # each plugin: check, build, unit tests, compliance suite and its features
pnpm typecheck && pnpm lint && pnpm format:check
```

Work on one plugin with `pnpm --filter ./plugins/<id> test`. The run must end with "<Name> <version> is fit for production." and no failed test.

Each plugin's `test` script runs `synoikia-plugin check` (manifest, `plugin.yaml`, versions) and `synoikia-plugin build` (the self-contained bundle, `plugin.yaml` validated and inlined). Then it runs the unit tests, core's compliance suite and the plugin's features.

`test/compliance.yaml` is the profile that core's compliance suite certifies the plugin against. It names the reads, writes, rejects, a lock case for each locked operation, the secrets and the connection test. A change there is a security change. Review its diff like a `plugin.yaml` diff. The format is in the [plugin authoring guide](https://github.com/synoikia-org/synoikia-core/blob/main/docs/plugin-authoring.md) › The compliance suite.

## Adding a plugin

`pnpm new` asks for an id, a name, an archetype and the auth. It writes `plugins/<id>/` with a manifest, a `plugin.yaml`, `src/`, `test/compliance.yaml` and a fake upstream. Then:

- Describe the upstream's operations in `plugin.yaml`: locks, split twins, classification overrides, `sensitiveParams`, `sensitiveResult`, confirmation literals.
- Keep code in `src/` for what needs logic: discovery, a split predicate, a custom confirmation source.
- Extend the fake upstream and `test/compliance.yaml`. Add a lock case for each locked operation.
- Write plugin-specific behavior in `features/<id>.feature`, and pure logic tests in `test/unit/`.

## Updating Synoikia

Each plugin's `package.json` ranges and the lockfile pin the SDK and core versions. To take a newer release, bump the ranges and run `pnpm install`.
