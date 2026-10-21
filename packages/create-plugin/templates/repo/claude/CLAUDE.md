# {{repoName}}

Plugins for [Synoikia](https://github.com/via-justa/synoikia-core). Authoring guide: `https://github.com/via-justa/synoikia-core/blob/main/docs/plugin-authoring.md`.

The Synoikia skills, rules and hooks for this repository come from the `synoikia-plugin-dev` plugin of the [Synoikia dev kit](https://github.com/synoikia-org/synoikia-dev-kit). `.claude/settings.json` enables it, and a session start hook says when it is not loaded. `.claude/guard-paths.json` lists the files that the path guard protects.

## Layout

| Path                            | What                                                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/<id>/manifest.json`    | Validated by the SDK schema: binding, connection form, `sensitiveKeys`, network hosts                                                         |
| `plugins/<id>/plugin.yaml`      | Policy as data: locks, split twins, classification overrides, `sensitiveParams`/`sensitiveResult`, confirm literals, plugin-specific settings |
| `plugins/<id>/src/`             | `index.ts` calls `runPlugin()`. `plugin.ts` uses `definePlugin` for discovery and the decisions that need logic. `auth.ts` signs requests     |
| `plugins/<id>/guides/`          | Markdown guides bundled at build time. Their hash versions attestation keys, so Prettier skips them                                          |
| `plugins/<id>/test/`            | `compliance.yaml` (the compliance profile), `fake.ts` that starts the fake upstream `fake-upstream.ts`, and unit tests in `unit/`             |
| `plugins/<id>/features/`        | `<id>.feature`: plugin-specific behavior, written with the compliance suite's steps on the profile's named calls                              |
| `plugins/<id>/RUNBOOK.md`       | Manual checklist against a real instance                                                                                                      |
| `.github/workflows/release.yml` | Packs, signs, indexes, verifies and publishes releases with `synoikia-plugin repo` (CI only), when the repository has it                      |

## Commands

Node 22.12+ (`.nvmrc` pins 22), pnpm 10.

```sh
pnpm new                                                         # add a plugin
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test   # what CI runs
pnpm --filter ./plugins/<id> test                                # one plugin: check, build, unit tests, compliance suite, features
pnpm check                                                       # manifests, plugin.yaml and versions
pnpm --filter ./plugins/<id> exec vitest run test/unit/<file>.test.ts   # one unit test file
pnpm format                                                      # fix formatting
```
