# §13 Verification

The feature files specify the behavior of each package. Each scenario runs as a test against the real interface of its package.

The feature files are in [`features/`](../../features/), one folder for each domain. The `features` project of each package's `vitest.config.ts` lists the domains that the package runs. The steps and the World of each package are in `packages/<package>/features/`.

[`DEVELOPMENT.md`](../../DEVELOPMENT.md#checks) › Checks tells how to run them. The rules for feature files and tests are in [`docs/workflow.md`](../workflow.md).

**Coverage floors.** `pnpm --filter @synoikia/core test:coverage` measures V8 coverage. It fails if `gate/`, `auth/`, `approvals/`, `sandbox/` or `crypto/` go below their floors in `packages/core/vitest.config.ts`.

**Plugins.** Each plugin repository has its own tests, on `@synoikia/plugin-sdk` and `@synoikia/core/testing` (§4.5).
