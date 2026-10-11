# Contributing to Synoikia

Thanks for taking the time to contribute. Bug reports, feature requests and pull requests are all welcome.

## Development setup

[DEVELOPMENT.md](DEVELOPMENT.md) covers the repository layout, local setup, running the server and the admin UI, and database schema changes. To write a plugin, see [docs/plugin-authoring.md](docs/plugin-authoring.md).

For the architecture and design rationale behind core, the sandbox, the permission gate and the plugin protocol, see the software design description in [`docs/design/`](docs/design/README.md).

## Before opening a pull request

CI (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build` and `pnpm test`, plus a Docker build. Run the same commands locally first:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check   # pnpm format to fix
pnpm typecheck
pnpm build
pnpm test
```

Keep changes focused: a bug fix doesn't need an accompanying refactor, and a new feature should come with tests covering it. Match the existing code style rather than introducing a new pattern for something already established elsewhere in the codebase.

When a change affects what the docs describe, update them in the same pull request: [README.md](README.md), [DEVELOPMENT.md](DEVELOPMENT.md), this file, [SECURITY.md](SECURITY.md) and the section of [`docs/design/`](docs/design/README.md) it belongs to.

## Releases

This repo publishes three npm packages (`@synoikia/plugin-sdk`, `@synoikia/core`, `@synoikia/create-plugin`) and a Docker image, each versioned independently — see [Publishing the npm packages](DEVELOPMENT.md#publishing-the-npm-packages) and [Publishing the Docker image](DEVELOPMENT.md#publishing-the-docker-image) in DEVELOPMENT.md. A pull request that changes what a package or the image ships bumps its `version`; [CLAUDE.md](CLAUDE.md) › Releases says which bump. If you're unsure, leave it and a maintainer will bump it before merge.

## Code of Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you're expected to uphold it.

## Reporting security issues

Please do not open a public issue for a security vulnerability — see [SECURITY.md](SECURITY.md) instead.
