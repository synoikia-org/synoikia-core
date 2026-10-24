## What / why

<!-- What does this pull request change, and why? Name the feature and the rule of the slice. -->

## Scenarios

<!-- The scenarios this slice makes green, by feature @id and scenario name. Write "none" for docs, CI or tooling. -->

## Build plan

<!-- The architect's plan: the slices in order, what each needs first, and the code each reuses. Later slices update it. -->

## Testing

<!-- How you saw the scenarios fail first and pass at the head. Add other checks you ran. -->

## Checklist

- [ ] Commits follow NoVibe's phases: `spec:` for `features/`, `arch:` for the model and the ADRs, any other prefix for the rest
- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` pass
- [ ] The git hooks pass on push
- [ ] Docs updated (README, DEVELOPMENT, CONTRIBUTING, SECURITY, `docs/deployment.md`, `docs/security-model.md`, `docs/adrs/`, `docs/reference.md`), where applicable
- [ ] No `version` bumped, and the `feature` or `breaking` label set where it applies (DEVELOPMENT.md › Which versions a release bumps)

<!-- Every ready pull request needs a line of its own here. The line starts with "Security audit:", then names the boundary and what the review found. Write "Security audit: none." and the reason when the change crosses no boundary. -->
