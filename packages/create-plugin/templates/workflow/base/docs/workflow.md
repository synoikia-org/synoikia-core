# Workflow

This repository builds every change spec first and test first. The rules below bind every contributor. CI checks them on each pull request. The git hooks run the same checks before a commit and a push.

`synoikia-plugin workflow sync` writes this file from `@synoikia/create-plugin`. Do not edit it here. Change the template in `via-justa/synoikia-core` instead.

## Steps

One change is one slice: one rule of one feature, with three scenarios at most. Each slice gets its own branch and pull request.

1. **Spec.** Write the scenarios in a feature file. Commit them as `spec: …`.
2. **Architecture and plan.** Write the build plan: the slices in order, and the existing code each one reuses. Put it in the pull request description. Place the slice in the model in `docs/architecture/` when it adds or moves a part. Commit as `arch: …`.
3. **Red.** Write the step definitions. Run the scenarios and see them fail because the behavior is missing. Commit as `test: …`.
4. **Green.** Write the least code that makes the scenarios pass. Use existing code that does the same work. Commit as `feat: …` or `fix: …`.
5. **Refactor.** Clean up with the scenarios green. Extract code that duplicates the same behavior into one shared function. Commit as `refactor: …`.
6. **Pull request.** Push and open the pull request. Fill in the template.

## Commits

Each commit belongs to one phase. Its subject starts with the phase, and it changes only the files of that phase.

| Prefix                 | Changes                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `spec:`                | Feature files only                                                 |
| `arch:`                | The architecture model only                                        |
| `test:`                | Step definitions, the World and unit tests only                    |
| `feat:` `fix:`         | Code. Not feature files and not the model                          |
| `refactor:`            | Code with the scenarios green. Not feature files and not the model |
| `docs:` `chore:` `ci:` | Documents, tooling and CI. Not feature files and not the model     |

A `feat:` or `fix:` commit that changes product code needs a `test:` commit before it. CI checks out that `test:` commit and runs its feature files. They must fail there. CI then runs them at the head of the branch, where they must pass.

A requirement that turns out wrong while you build is not worked around. Change it in its own `spec:` commit, where the reviewer sees it.

Pull requests merge by rebase, so every commit lands on `main`. A `spec:` or `test:` commit is red by design. Skip it in `git bisect` with `git bisect skip`.

## Branches

A branch name is `<component>/<summary>` in lowercase kebab-case. The summary is two to four words about the whole change: `core/auth-refactoring`.

- The component is the package or plugin where the most important change lands, or `ci`, `docs`, `skills` or `deps`.
- Do not use generated names, random words, session IDs or dates.
- After a pull request merges, start follow-up work on a new branch.

## Feature files

Feature files live in `features/<domain>/<feature>.feature` inside the package or plugin they specify. Steps and the World live next to them, in `features/**/*.ts`.

- **One feature per file, with an `@id:<kebab-case>` tag.** Other files refer to the feature by this id. The id never changes after a push.
- **Every scenario is in a `Rule:`.** A rule groups the scenarios that show one business rule.
- **Write outcomes, not solutions.** Say what someone can do and what they see. Do not name screens, clicks, endpoints, status codes, wire formats or tables.
- **Write short scenarios.** Use five steps at most, with one `When` and one `Then`. A `Background:` has four steps at most.
- **Use real values from the World.** Name the World's things, not a category. Write `Given the instance "nas-01" has 3 pools`, not `Given an instance with pools`.
- **Write what someone can see in a `Then`.** Name what the admin, the agent or the upstream service observes, not an internal verdict.
- **Use the field's standard terms and the glossary's words.** Use each term with one meaning.
- **Tags.** Use only `@id:<kebab-case>`, `@backlog`, `@long-running` and `@exclusive`. `@backlog` marks a scenario not built yet, `@long-running` a slow scenario, and `@exclusive` a scenario that must run alone in its test process.
- **No comments.** Put an explanation in the feature narrative.

Scenarios run in vitest through quickpickle. They drive the product through its real interface: the MCP endpoints, the Admin API, the plugin entry or the portal in a browser. They never call internal services and never mock internal modules.

## Tests

Feature files are the only behavior tests. A new `*.test.ts` file must be a pure-function unit test in a `test/unit/` directory. Do not test libraries, frameworks or third-party APIs.

## Writing

All prose follows ASD-STE100 Simplified Technical English. This includes documents, skills, feature files and pull request descriptions.

- Write short sentences: 20 words at most for an instruction, 25 for a description.
- Write one instruction per sentence. Use the active voice and approved plain words.
- Do not use semicolons. Write two sentences.
- Do not use em dashes.
- Write one topic per paragraph.
- Do not repeat a fact. Link to the place that states it.
- Prefer tables and lists to long paragraphs.

## Security

- Do not commit credential files. The pre-commit hook refuses `.env` files, private keys and secret files by name. CI runs gitleaks on every pull request.
- A pull request that changes a security path needs a line of its own in its description: `Security audit: <boundary and findings>` or `Security audit: none. <why>`. The paths are in `synoikia.workflow.securityPaths` in the root `package.json`.

## Checks

Install the git hooks once per clone:

```sh
pnpm hooks:install
```

The hooks run the `workflow` script of the branch that you have checked out. Before you check out a pull request from someone you do not trust, read its changes to `.githooks/` and `package.json`.

| Command                                    | Checks                                                       |
| ------------------------------------------ | ------------------------------------------------------------ |
| `pnpm workflow check-branch`               | The branch name                                              |
| `pnpm workflow check-phases --base main`   | Commit prefixes and phases. `--red-green` runs the red check |
| `pnpm workflow check-features --base main` | Feature files, the slice size and new test files             |
| `pnpm workflow check-prose --base main`    | The writing rules on added lines                             |
| `pnpm workflow pre-push`                   | All of the above, as the pre-push hook runs them             |

A pull request labelled `backfill` specifies behavior that exists already. Its scenarios pass at once, so CI skips the red check and the slice size for it.
