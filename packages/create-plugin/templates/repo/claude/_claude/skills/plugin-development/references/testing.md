# Testing

Vitest, one `plugins/<id>/test/` directory per plugin. The plugin's `test` script runs `synoikia-plugin check`, rebuilds `dist/index.js`, then all tests. The e2e tests run the **built** bundle, so rebuild after any change to `src/` or `plugin.yaml` before running a single file. New or changed behavior ships with a test in the same change, including the failure path.

## Pick the smallest level that proves the behavior

| What                                                            | How                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A pure function (catalog building, classification, a transform) | Import and call it directly, in a test file named after its module                                                        |
| The client against the upstream protocol                        | The client plus the fake upstream                                                                        |
| Handlers: invoke, summaries, confirm literals, result masking   | The plugin factory from `src/plugin.ts` + `init` against the fake upstream, shut down in `afterAll` (`plugin.test.ts`) |
| What the plugin tells core                                      | `golden.test.ts`, added once the catalog settles: `toMatchFileSnapshot('__golden__/<name>.json')` on stable, key-sorted JSON                                |
| The full path through core: gate, approvals, redaction, audit   | `startPluginHarness` + `checkPluginContract` from `@synoikia/core/testing` on the built bundle (`e2e.test.ts`)              |

## The fake upstream

- Each plugin has one (`test/fake-upstream.ts`, with `test/fake-auth.ts` for its auth), built on `startFakeHttp` from `@synoikia/core/testing` for HTTP or a local server for WebSocket. Tests never reach the real network.
- Extend it to answer every call the change makes, including the responses that carry secrets, the error statuses and the permission denials.
- Export its credentials and fixed values (`CREDENTIALS`, `UPSTREAM_SECRET`, …) for the tests to use; record calls so tests can assert what the plugin sent.

## Golden files

- `test/__golden__/` records descriptors, summaries, confirm literals, classification and masking. Add `**/__golden__/` to `.prettierignore` with the first one.
- A diff there is a security change. Update only on purpose: `pnpm --filter ./plugins/<id> exec vitest run test/golden.test.ts -u`, then read the diff and explain it in the PR.
- A new lock, sensitive field or summary shape gets a golden entry, not only an e2e case.

## Rules

- Assert on what core or the model sees: the descriptor, the summary, the confirm literal, the masked result, the error code, the harness outcome (`ok`, awaiting approval, refused). Not on private fields.
- A lock gets an e2e case that proves it needs the typed literal. A secret gets a case that proves it stays out of results, approvals and the audit log.
- Every new error path gets a test that hits it and checks its `ErrorCodes` value.
- Keep `checkPluginContract` passing in `e2e.test.ts`.
