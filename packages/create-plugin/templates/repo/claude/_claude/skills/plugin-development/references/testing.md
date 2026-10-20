# Testing

Vitest, with quickpickle for feature files. The plugin's `vitest.config.ts` uses `complianceConfig` from `@synoikia/core/testing/compliance`. The `test` script runs these steps:

1. `synoikia-plugin check`
2. `synoikia-plugin build`, which rebuilds `dist/index.js`
3. the unit tests in `test/unit/`
4. core's compliance suite, from `test/compliance.yaml`
5. the plugin's own `features/<id>.feature`

The suite and the features run the **built** bundle. Rebuild after any change to `src/` or `plugin.yaml` before you run one file.

The run must end with "<Name> <version> is fit for production." and no failed test. A failing own feature does not change the verdict line, but it fails the run.

## Pick the place that proves the behavior

| What                                                                  | Where                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| A pure function (catalog building, classification, a transform)       | A unit test in `test/unit/` that imports and calls it         |
| Reads, writes, rejected calls, locks, secrets and the connection test | A case in `test/compliance.yaml`                              |
| Plugin-specific behavior through core: approvals, summaries, levels   | A scenario in `features/<id>.feature`, with the suite's steps |

`docs/workflow.md` › Tests has the rules for test files. A new `*.test.ts` file is a pure-function unit test in `test/unit/`.

## The compliance profile

`test/compliance.yaml` tells core's suite how to drive the plugin against its fake upstream. The format and the steps are in core's `docs/plugin-authoring.md` › The compliance suite.

| Key              | What                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `fake`           | `test/fake.ts`, the module that starts the fake upstream                 |
| `connection`     | The connection values, with `${fake.<name>}` for the fake's values       |
| `reads`          | Calls that must classify as reads                                        |
| `writes`         | Calls that must classify as writes                                       |
| `rejects`        | Calls that core or the plugin must refuse                                |
| `locks`          | One case for each locked operation and each split twin, with its literal |
| `secrets`        | Calls whose upstream values must never reach the agent                   |
| `connectionTest` | Connection values that the connection test must reject                   |
| `calls`          | Named calls that `features/<id>.feature` uses                            |

- A lock with no case fails the suite. Add a case when you add a lock or a split twin.
- A diff of `test/compliance.yaml` is a security change. Change a case only on purpose, and explain it in the PR.

## The fake upstream

- Each plugin has one in `test/` (`fake-upstream.ts` as `pnpm new` writes it). Build it on `startFakeHttp` from `@synoikia/core/testing` for HTTP, or on a local server for WebSocket.
- Tests never reach the real network.
- `test/fake.ts` exports `start()`. It starts the fake and returns its URL, `close()` and the values that the profile names. It can also return `reset()`.
- Extend the fake to answer every call the change makes. Include the responses that hold secrets, the error statuses and the permission denials.

## Feature files

- Write scenarios with the suite's steps on the profile's named calls. The step table is in core's `docs/plugin-authoring.md`.
- Follow `docs/workflow.md` › Feature files: a `Rule:` for each scenario, outcomes and not solutions, five steps at most.
- Assert on what the agent or the human sees: the result, the approval text, the literal to type, the error code.

## Unit tests

- Assert on what core or the model sees: the descriptor, the summary, the confirm literal, the masked result, the error code. Not on private fields.
- Give each new error path a test that hits it and checks its `ErrorCodes` value.
