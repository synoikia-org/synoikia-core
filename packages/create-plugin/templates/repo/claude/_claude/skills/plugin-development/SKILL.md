---
name: plugin-development
description: >-
  How to write and review plugin code in this Synoikia plugin repository: plugins/<id>/src, plugin.yaml,
  manifest.json and the plugin's tests. Use it for any task that changes or reviews a plugin, even when the
  request names only an operation, an upstream endpoint, a lock, a secret or a bug and never says
  "TypeScript" or "plugin.yaml". Examples: add or lock an operation; split an operation into twins; mark a
  param or result field sensitive; change a summary or confirmation literal; fix a client, a transport or
  discovery; add a connection field; extend a fake upstream; write or fix unit tests, the compliance profile
  or a plugin feature; review a plugin diff. Not for scaffolding a new plugin (add-plugin, then this skill for
  the code) or version bumps (release-plugin).
---

# Plugin development

A plugin is a Node 22 ESM process that describes one upstream API to core: its catalog, classification, targets, summaries, confirmation literals and sensitive fields. Core does the rest. New code must look like the code around it. Make the smallest change that does the job, with one shared way to do each thing. Add no dependency for what a few lines or the SDK already do.

`CLAUDE.md` holds the repo rules (bundle, network hosts, secrets, versions, security review). This skill is how to write the change. Load a reference only when the task touches its area:

| Task touches                                                                | Read                       |
| --------------------------------------------------------------------------- | -------------------------- |
| Types, narrowing upstream data, errors, imports, module layout              | `references/typescript.md` |
| Tests, the fake upstream, `test/compliance.yaml`, the plugin's feature file | `references/testing.md`    |

## Rules for every change

1. **Reuse first.** Before you write a helper, look in the plugin's own `src/` and in `@synoikia/plugin-sdk`. The SDK has `definePlugin`, `compileRules`, `parsePluginSettings`, `requireString`, `requireField`, `isPlainObject`, `truncate` and `clip`. It also has `PluginError`/`ErrorCodes`, `upstreamError`, `HttpJsonClient`, `singleFlight`, `PendingRequests` and the OpenAPI and static catalog adapters. Use it, or extend it. If the SDK lacks it and another plugin would need it too, it belongs in core's SDK, released first.
2. **Policy in `plugin.yaml`, logic in `src/`.** Locks, splits, classification overrides, `sensitiveParams`, `sensitiveResult`, confirm literals, guidance, `exclude`/`include` and upstream lists are YAML. Code is only for a decision YAML can't express (a path check, a target lookup, a `splitWhen` predicate).
3. **Describe, don't decide.** No plugin-side allow/deny switch, approval prompt, rate limit or secret handling: core's gate, approvals and redaction own them.
4. **Fail closed.** Anything unclassified is a write. A rule's `classification` never unlocks. An upstream shape the code doesn't know is redacted or refused, not passed through.
5. **Narrow upstream data at the edge.** Responses, events and specs are `unknown` until checked with `isPlainObject`, `requireString` and friends. Past that point, trust the narrowed type.
6. **Secrets never leave masked.** Credential fields are `writeOnly`, use the `secret` widget and are in `sensitiveKeys`. Secret fields the upstream returns go in `sensitiveKeys` and `sensitiveResult`. Summaries, errors and logs never carry a secret or a raw upstream body.
7. **Every host is declared.** A new upstream URL goes in `manifest.json` `network.hosts`, and every runtime dependency and data file is bundled into `dist/index.js`.
8. **Profile diffs are security diffs.** A change to `test/compliance.yaml` changes what core certifies. Change it only on purpose, and say in the PR what changed and why.
9. **Small and direct.** No speculative options, wrappers or config for one caller. Comments are one or two lines, for a reason or a design `§` reference only.
10. **Tests ship with the change.** Specify the behavior first, as `docs/workflow.md` says. Logic gets a unit test in `test/unit/`. Behavior at the plugin boundary gets a profile case or a scenario in `features/<id>.feature`. Extend the fake upstream to match.

## Checks

Run from the repo root before finishing:

```sh
pnpm --filter ./plugins/<id> test                   # check, build, unit tests, compliance suite, features
pnpm lint && pnpm format:check && pnpm typecheck
pnpm check                                           # manifests, plugin.yaml and versions
pnpm workflow pre-push                               # branch, phases, features and prose
```

The plugin run must end with "<Name> <version> is fit for production." and no failed test.

Then run the `security-reviewer` subagent when `CLAUDE.md` › Security review lists a path you touched. Don't bump the version unless the user asked (`release-plugin`).

## Reviewing

Lead with what tools can't catch. Say why each one matters:

- A lock or sensitive rule dropped or narrowed.
- A classification that turns a write into a read.
- A secret that reaches a summary or an error.
- A host missing from `network.hosts`.
- Logic in `src/` that belongs in `plugin.yaml`, or a plugin-side check that duplicates core.
- An `as` cast that hides an upstream shape.
- A `test/compliance.yaml` change with no reason given, or a case removed or weakened.
- A new upstream secret with no `secrets` entry, or no fake response that holds it.
