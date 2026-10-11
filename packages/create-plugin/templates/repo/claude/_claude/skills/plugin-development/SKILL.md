---
name: plugin-development
description: >-
  How to write and review plugin code in the Synoikia plugins repo: plugins/<id>/src, plugin.yaml,
  manifest.json and the plugin's tests. Use it for any task that changes or reviews a plugin, even when the
  request names only an operation, an upstream endpoint, a lock, a secret or a bug and never says
  "TypeScript" or "plugin.yaml". Examples: add or lock an operation; split an operation into twins; mark a
  param or result field sensitive; change a summary or confirmation literal; fix a client, a transport or
  discovery; add a connection field; extend a fake upstream; write or fix unit, golden or e2e tests; review a
  plugin diff. Not for scaffolding a new plugin (add-plugin, then this skill for the code) or version bumps
  (release-plugin).
---

# Plugin development

A plugin is a Node 22 ESM process that describes one upstream API to core: its catalog, classification, targets, summaries, confirmation literals and sensitive fields. Core does the rest. New code must look like the code around it: the smallest change that does the job, one shared way to do each thing, and no new dependency for what a few lines or the SDK already do.

`CLAUDE.md` holds the repo rules (bundle, network hosts, secrets, versions, security review). This skill is how to write the change. Load a reference only when the task touches its area:

| Task touches                                                                 | Read                       |
| ---------------------------------------------------------------------------- | -------------------------- |
| Types, narrowing upstream data, errors, imports, module layout               | `references/typescript.md` |
| Writing or reviewing tests, the fake upstream, golden files, the e2e harness | `references/testing.md`    |

## Rules for every change

1. **Reuse first.** Before writing a helper, look in `@synoikia/plugin-sdk` (`definePlugin`, `compileRules`, `parsePluginSettings`, `requireString`, `requireField`, `isPlainObject`, `truncate`, `clip`, `PluginError`/`ErrorCodes`, `upstreamError`, `HttpJsonClient`, `singleFlight`, `PendingRequests`, the OpenAPI and static catalog adapters) and in the plugin's own modules (`plugin.ts`, `auth.ts`, `client.ts`). Use it, or extend it. If the SDK lacks it and another plugin would need it too, it belongs in core's SDK, released first.
2. **Policy in `plugin.yaml`, logic in `src/`.** Locks, splits, classification overrides, `sensitiveParams`, `sensitiveResult`, confirm literals, guidance, `exclude`/`include` and upstream lists are YAML. Code is only for a decision YAML can't express (a path check, a target lookup, a `splitWhen` predicate).
3. **Describe, don't decide.** No plugin-side allow/deny switch, approval prompt, rate limit or secret handling: core's gate, approvals and redaction own them.
4. **Fail closed.** Anything unclassified is a write; a rule's `classification` never unlocks; an upstream shape the code doesn't know is redacted or refused, not passed through.
5. **Narrow upstream data at the edge.** Responses, events and specs are `unknown` until checked with `isPlainObject`, `requireString` and friends; past that point, trust the narrowed type.
6. **Secrets never leave masked.** Credential fields are `writeOnly`, use the `secret` widget and are in `sensitiveKeys`. Secret fields the upstream returns go in `sensitiveKeys` and `sensitiveResult`. Summaries, errors and logs never carry a secret or a raw upstream body.
7. **Every host is declared.** A new upstream URL goes in `manifest.json` `network.hosts`, and every runtime dependency and data file is bundled into `dist/index.js`.
8. **Golden diffs are security diffs.** When a plugin has `test/golden.test.ts`, a change in `test/__golden__/` changes what core sees. Update it only on purpose, and say in the PR what changed and why.
9. **Small and direct.** No speculative options, wrappers or config for one caller. Comments are one or two lines, for a reason or a constraint only.
10. **Tests ship with the change**: a unit test for the logic, and an e2e case with the fake upstream extended when it crosses the plugin boundary.

## Checks

Run from the repo root before finishing:

```sh
pnpm --filter ./plugins/<id> test                   # check, rebuild the bundle, then unit + e2e
pnpm lint && pnpm format:check && pnpm typecheck
pnpm check                                           # manifests, plugin.yaml and versions
```

Then run the `security-reviewer` subagent when `CLAUDE.md` › Security review lists a path you touched. Don't bump the version unless the user asked (`release-plugin`).

## Reviewing

Lead with what tools can't catch: a lock or sensitive rule dropped or narrowed, a classification that turns a write into a read, a secret that reaches a summary, error or golden file, a host missing from `network.hosts`, logic in `src/` that belongs in `plugin.yaml`, a plugin-side check that duplicates core, an `as` cast hiding an upstream shape, a golden update with no reason given, a missing e2e case for a new lock or secret. Say why each matters.
