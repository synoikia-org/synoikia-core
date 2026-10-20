# {{repoName}}

Plugins for [Synoikia](https://github.com/via-justa/synoikia-core). Authoring guide: `https://github.com/via-justa/synoikia-core/blob/main/docs/plugin-authoring.md`.

**A plugin only describes its upstream API. Core decides what is allowed.** Core's sandbox, permission gate, approvals, redaction and audit apply to every plugin. A plugin supplies the catalog, the classification (read, write, locked), targets, summaries, confirmation literals and `sensitiveKeys`. It never adds its own allow/deny switch, approval prompt or secret handling. If a plugin needs something core doesn't offer, that is a change in Synoikia core, released first.

Every task that changes the repo starts with the `change-workflow` skill (`.claude/skills/change-workflow/`). Changes are built spec first and test first, one slice for each pull request. The `requirements-engineer`, `architect` and `developer` skills run the steps, and prose follows the `technical-writing` skill. The rules for commits, branches, feature files, tests and prose are in `docs/workflow.md`. The git hooks (`pnpm hooks:install`, once per clone) and the `Workflow` CI job check them.

Plugin code, `plugin.yaml`, manifest and test work follows the `plugin-development` skill (`.claude/skills/plugin-development/`). Its rules: policy in YAML, SDK helpers before new code, fail closed, and `test/compliance.yaml` diffs reviewed as security changes. Load it before writing or reviewing a plugin change.

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
pnpm new                                                         # add a plugin (see the add-plugin skill)
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test   # what CI runs
pnpm --filter ./plugins/<id> test                                # one plugin: check, build, unit tests, compliance suite, features
pnpm check                                                       # manifests, plugin.yaml and versions
pnpm --filter ./plugins/<id> exec vitest run test/unit/<file>.test.ts   # one unit test file
pnpm format                                                      # fix formatting
pnpm hooks:install                                               # once per clone: the workflow git hooks
pnpm workflow pre-push                                           # the workflow checks (branch, phases, features, prose)
```

Each plugin's `vitest.config.ts` uses `complianceConfig` from `@synoikia/core/testing/compliance`. Core's compliance suite and the plugin's features run the **built** `dist/index.js` on the real core. The bundle runs as a permission-confined child against the fake upstream. A stale bundle gives stale results, so rebuild after you change `src/` or `plugin.yaml`. The `test` script does this (`synoikia-plugin build` validates and inlines `plugin.yaml`).

A plugin is ready when its `test` run ends with "<Name> <version> is fit for production." and no test fails. A failing own feature does not change that verdict line, but it fails the run. The suite and its steps are in core's `docs/plugin-authoring.md` › The compliance suite.

**Policy data goes in `plugin.yaml`, logic in `src/`.** Locks, splits, sensitive params and results, confirmation literals, guidance and upstream-specific lists are YAML that the SDK's `compileRules` applies. Only decisions that need code stay in TypeScript.

**`test/compliance.yaml` is policy too.** It gives the reads, writes, rejects, a lock case for each locked operation, the secrets and the connection test. A change to it is a security change, so review its diff like a `plugin.yaml` diff.

## Rules that break releases or installs

- **Self-contained bundle.** Under the Node permission model the plugin can read nothing outside its own package directory. So every runtime dependency and data file must be bundled into `dist/index.js`. `synoikia-plugin build` does it.
- **Network hosts.** `manifest.json` `network.hosts` lists every host the plugin connects to. A new upstream URL, such as a spec mirror, goes there too. Admins review it before enabling the plugin, and an update that changes it installs disabled. Core doesn't enforce it (the plugin process can reach any host), so it must be accurate.
- **Secrets.** Every credential field is `writeOnly: true` in the connection schema, uses the `secret` widget, and is listed in `sensitiveKeys`. So is any secret field the upstream returns. `synoikia-plugin check`, run by each plugin's `test` script, checks the connection schema. A `secrets` case in `test/compliance.yaml` checks each secret the upstream returns.
- **Versions.** `version` in `manifest.json` and `package.json` must match. A version that is released can never change, so any change to a released plugin needs a new version. Bump only when asked. The `release-plugin` skill covers it.
- **SDK and core ranges.** Plugins depend on published `@synoikia/plugin-sdk`, `@synoikia/core` and `@synoikia/create-plugin` from npm. To update, bump the ranges and run `pnpm install`.

## Conventions

Strict TypeScript with `noUncheckedIndexedAccess` and `verbatimModuleSyntax`: use `import type`, and `.js` extensions on relative imports. Unused variables are allowed only with a `_` prefix. Keep comments minimal: one or two lines, only for what the code can't say (a reason, a constraint, a design § reference). Do not write multi-line comment blocks in code, YAML or workflows. Prettier formats everything, and a hook runs it after each edit. Behavior that crosses the plugin boundary goes in `features/<id>.feature` or `test/compliance.yaml`, with the fake upstream extended to match. Pure logic gets a unit test in `test/unit/`.

## Security review

Before you open a PR that touches a security path, run the `security-reviewer` subagent (`.claude/agents/security-reviewer.md`) on the diff. Address its findings. The security paths include a plugin's `manifest.json`, `plugin.yaml`, `src/`, dependencies and `test/compliance.yaml`, and `.github/workflows/`. The full list is in `synoikia.workflow.securityPaths` in the root `package.json`.

The reviewer checks classification, request building, approval summaries, secrets, network hosts and the release flow. It also runs `pnpm audit` and triages known CVEs by whether the dependency is bundled into a plugin. Put its `Security audit:` line in the PR description. The `Workflow` CI job checks for it.

## Protected files

A PreToolUse hook (`.claude/hooks/guard-paths.mjs`) denies edits to `pnpm-lock.yaml` and `plugins/*/dist/`, and asks first for `minisign.pub`. Never touch the `MINISIGN_SECRET_KEY` flow in `.github/workflows/release.yml` unless asked.
