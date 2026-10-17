## What / why

<!-- What does this pull request change, and why? Name the feature and the rule of the slice. -->

## Scenarios

<!-- The scenarios this slice makes green, by feature @id and scenario name. Write "none" for docs, CI or tooling. -->

## Build plan

<!-- The architect's plan: the slices in order, what each needs first, and the code each reuses. Later slices update it. -->

## Testing

<!-- How you saw the scenarios fail at the test: commit and pass at the head. Add other checks you ran. -->

## Checklist

- [ ] Commits follow the phases in `docs/workflow.md` (`spec:`, `arch:`, `test:`, `feat:`/`fix:`, `refactor:`)
- [ ] `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm workflow pre-push` passes
- [ ] Docs updated (README, DEVELOPMENT, CONTRIBUTING, SECURITY, `docs/design/`), where applicable
- [ ] Versions bumped where required (CLAUDE.md › Releases)

<!-- A pull request that changes a security path (root package.json › synoikia.workflow.securityPaths) needs a line of its own here. The line starts with "Security audit:", then names the boundary and what the review found. Write "Security audit: none." and the reason when the change crosses no boundary. -->
