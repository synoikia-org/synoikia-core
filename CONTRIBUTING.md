# Contributing to Synoikia

Thanks for taking the time to contribute. Bug reports, feature requests and pull requests are all welcome.

## Development setup

[DEVELOPMENT.md](DEVELOPMENT.md) covers the repository layout, local setup, running the server and the admin UI, and database schema changes. To write a plugin, see [docs/plugin-authoring.md](docs/plugin-authoring.md).

The design decisions behind core, the sandbox, the permission gate and the plugin protocol are the ADRs in [`docs/adrs/`](docs/adrs/). The architecture model is in [`docs/architecture/`](docs/architecture/README.md), and other facts are in [`docs/reference.md`](docs/reference.md).

## How a change is built

Every change follows [NoVibe](https://github.com/novibe-org/novibe): a Gherkin feature file, then the LikeC4 model, then the build, test first. Each slice is one pull request. Install the git hooks once, so the checks run before you push:

```sh
pnpm hooks:install
```

- A `spec:` commit changes only `features/`. An `arch:` commit changes only `docs/architecture/` and `docs/adrs/`. Any other commit changes neither.
- Prose follows ASD-STE100 Simplified Technical English: short sentences, no semicolons, no em dashes.
- A ready pull request has a line of its own that starts with `Security audit:`.

The `Workflow` CI job runs the same checks as the hooks, and checks the prose of the pull request description.

## Before opening a pull request

CI (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`, plus a Docker build. It splits core's scenarios across four runners. The `e2e-ui` job runs the portal's scenarios in Chromium. While you work, run only the feature folders you change (`DEVELOPMENT.md` › Checks). Run the same commands locally first:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check   # pnpm format to fix
pnpm typecheck
pnpm build
pnpm test
```

Keep changes focused: a bug fix doesn't need an accompanying refactor, and a new feature starts with its scenarios. Match the existing code style rather than introducing a new pattern for something already established elsewhere in the codebase.

When a change affects what the docs describe, update them in the same pull request: [README.md](README.md), [DEVELOPMENT.md](DEVELOPMENT.md), this file, [SECURITY.md](SECURITY.md) and the ADR or [`docs/reference.md`](docs/reference.md) section it belongs to.

## Releases

This repo publishes three npm packages (`@synoikia/plugin-sdk`, `@synoikia/core` and `@synoikia/create-plugin`) and a Docker image. Each has its own version. A GitHub release publishes them together. See [Releases](DEVELOPMENT.md#releases) in DEVELOPMENT.md. Do not bump a `version` in a pull request. Label the pull request `feature` or `breaking` when it is one. [Which versions a release bumps](DEVELOPMENT.md#which-versions-a-release-bumps) gives the rule. If you are not sure, leave the labels to a maintainer.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you're expected to uphold it.

## Reporting security issues

Please do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md) instead.
