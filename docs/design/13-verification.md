# §13 Verification

The feature files specify the behavior of each package. Each scenario runs as a test against the real interface of its package.

| Package                   | Feature files                                                                |
| ------------------------- | ---------------------------------------------------------------------------- |
| `@synoikia/core`          | [`packages/core/features/`](../../packages/core/features/)                   |
| Admin portal              | [`packages/admin-ui/features/`](../../packages/admin-ui/features/)           |
| `@synoikia/plugin-sdk`    | [`packages/plugin-sdk/features/`](../../packages/plugin-sdk/features/)       |
| `@synoikia/create-plugin` | [`packages/create-plugin/features/`](../../packages/create-plugin/features/) |

[`DEVELOPMENT.md`](../../DEVELOPMENT.md#checks) › Checks tells how to run them. The rules for feature files and tests are in [`docs/workflow.md`](../workflow.md).

**Coverage floors.** `pnpm --filter @synoikia/core test:coverage` measures V8 coverage. It fails if `gate/`, `auth/`, `approvals/`, `sandbox/` or `crypto/` go below their floors in `packages/core/vitest.config.ts`.

**Plugins.** Each plugin repository has its own tests, on `@synoikia/plugin-sdk` and `@synoikia/core/testing` (§4.5).
