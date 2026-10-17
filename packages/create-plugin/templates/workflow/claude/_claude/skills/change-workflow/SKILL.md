---
name: change-workflow
description: >-
  How to carry a change from request to merged PR: size it, plan it, then run one slice at a time through
  requirements, architecture and build, spec first and test first. Use it at the start of every task that will
  change code, config, CI, tests or docs in this repo, even when the request is a question, a bug report or
  "just do X", and before writing a plan. Examples: add a feature, an operation or an endpoint; fix a bug;
  refactor a module; migrate a library; change the schema, auth or the gate; bump versions; "can you clean up
  X". Not for questions that change nothing (explain, review, estimate), or for PR babysitting on a PR that
  already exists.
---

# Change workflow

**The user decides. You build what the user decided.** The rules for specs, commits, branches, tests and prose are in `docs/workflow.md`. Read it before the first step. This skill says how you run them.

## 1. Size the task

| Small                                              | Big                                                     |
| -------------------------------------------------- | ------------------------------------------------------- |
| One concern in one package or plugin               | Several concerns, packages or plugins                   |
| One rule, three scenarios at most                  | More than one slice                                     |
| No security path in `CLAUDE.md`, or a one-line fix | A security path, an API contract, the SDK or the schema |

Check the request against the repo before you plan. If the work is done already or the premise is wrong, show the evidence and ask what the user meant. If you are not sure of the size, treat the task as big.

A big task goes through plan mode (`EnterPlanMode`) before any edit, branch or commit. The plan lists the slices in order. Each slice is one pull request into `main`.

## 2. Run one slice

1. **Branch.** Create a branch from `main` with a name that passes `pnpm workflow check-branch`. Do not use a session's generated branch name.
2. **Requirements.** Use `requirements-engineer`. Its output is the feature file and a `spec:` commit.
3. **Architecture.** Use `architect` when the slice adds or moves a part of the model. Its output is an `arch:` commit.
4. **Build.** Use `developer`. Its output is the `test:`, `feat:` or `fix:` and `refactor:` commits and a ready pull request.

Move to the next step only when the user agrees that the current step is done. Skipping a step is the user's decision. Propose it and wait for a clear yes.

## 3. Ask in rounds

**Facts are yours. Decisions are the user's.** Find what the code, the specs and the model can tell you. Ask about everything that someone could decide in a different way.

- Ask with `AskUserQuestion`, four questions at most for each call. Put your recommendation first and mark it "(Recommended)".
- Write each answer into the file before you ask the next round.
- Names come from the field's standard. Offer two or three terms with their source and ask. Do not pick a name silently.

## 4. Subagents

Subagents keep your context small. They do not change the structure of the work.

- You own the slice, the branch, the commits and the pull request. Phases run in order, never in parallel.
- You run the interviews and write the feature file yourself.
- Give a subagent one bounded task with fixed inputs. Example: "Write the steps for `features/gate/deny.feature`. They must fail on a missing behavior, not on missing glue."
- The subagent returns a short summary and its diff. You run the scenarios, check red or green, and make the commit.
- The history must look the same as a run without subagents. CI checks the phases.

## 5. The pull request

- Open the pull request as a draft after the `spec:` commit. Watch it with `subscribe_pr_activity` until it merges or closes.
- Run the repo's checks (`CLAUDE.md` › Commands) and `pnpm workflow pre-push` before each push.
- Run the `security-reviewer` subagent when the diff touches a security path. Put its `Security audit:` line in the pull request description.
- Mark the pull request ready only when every scenario of the slice is green and CI is green on its head.
- When the change touches a user interface, send screenshots of each changed page and state before the pull request goes ready. Cover light and dark mode, and desktop and mobile width when the layout changed.

## 6. Long tasks

A task that runs for more than about an hour needs tool calls that run without approval. If the session is not in Auto mode, say so and suggest **Auto** in the mode menu next to the prompt box. Do not change the mode yourself.
