---
name: change-workflow
description: >-
  How to carry a code change from request to merged PR in Synoikia core: size the task, go through plan mode
  for anything logical or big, propose a work pattern (one PR, or a chain of child PRs into an integration
  branch run unattended) for the user to approve, and suggest Auto mode for long runs. Use it at the start of
  every task that will change code, config, CI or docs in this repo, even when the request is phrased as a
  question, a bug report or "just do X", and before writing a plan. Examples: add a feature or endpoint;
  refactor a module or the admin UI; fix a bug; migrate a library; change the schema, auth or the gate;
  bump versions; "can you clean up X". Use it alongside vue-development or core-development, which say how
  to write the code. Not for questions that change nothing (explain, review, estimate), or for PR babysitting
  on a PR that already exists.
---

# Change workflow

This skill decides **how** a change gets done: which mode, which work pattern, and when to stop for the user. The `vue-development` and `core-development` skills say how the code itself looks.

## 1. Size the task before touching anything

| Small                                                                         | Big or logical                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| One concern, a few files in one package                                       | Several concerns, modules or packages                                                      |
| No change to behavior a user or plugin sees, or one small, local behavior fix | New behavior, a refactor, a library migration, a schema change                             |
| Nothing in a security path, or a one-line fix with its test                   | Changes to the gate, sandbox, approvals, auth, crypto, plugins, an API contract or the SDK |
| Reviewable as one PR in one sitting                                           | More than one PR's worth of review, or the work splits into steps                          |

If you're unsure, treat it as big. Underestimating costs a rewrite; overestimating costs one short plan.

## 2. Big or logical: plan mode first

Enter plan mode (`EnterPlanMode`) before any edit, branch or commit, and stay there until the user approves the plan. A big change built without an agreed plan is the most expensive kind of rework, and plan mode is where the user can still redirect it cheaply. Read-only exploration is fine before and during planning.

## 3. Propose a work pattern; the user approves it

Recommend one pattern, say why in a sentence, and get approval: in the plan for a big change, or with a short question (AskUserQuestion) for a small one. Don't start until the user picks.

**Single PR** (small changes):

- Work on the session's designated branch (restart it from `main` if its PR already merged), make the change, run the repo's checks (`CLAUDE.md` › Commands), run the `security-reviewer` subagent when `CLAUDE.md` › Security review lists a path you touched, then push and open one draft PR into `main`.

**PR chain, unattended** (big changes):

- An integration branch from `main` with a draft PR into `main`; that PR's body holds the progress table and the decisions log.
- One child branch and PR per step into the integration branch, merged (squash) after green CI, one at a time.
- One implementation subagent per step, so the main session only orchestrates and its context stays small.
- Stop only on blocking decisions; record everything else in the decisions log for the user to settle before the final merge.
- Never merge to `main`. The user merges the integration PR.

Read `references/pr-chain.md` before starting a chain: it has the per-step loop, the PR body template, the blocking list and how to resume after an interruption.

## 4. Long task and not in Auto mode: suggest switching

A PR chain, or any task that will run for more than about an hour or across many tool calls, needs tool calls to run without a person approving each one. If the session isn't in Auto mode, say so before starting and suggest picking **Auto** in the mode menu next to the prompt box. Say what it avoids: the chain stalling on a permission prompt while the user is away. Don't switch it yourself; it is the user's setting.

## 5. Running unattended

- After every step, update the plan file's status section and the integration PR's progress table. They are the resume point after a usage limit or a restart.
- Subagents commit early, in coherent chunks, so an interruption loses little.
- PR events wake the session; don't poll. A one-time `send_later` check-in covers a lost event. Let a stale check-in fire and do nothing rather than deleting it.
- Subscribe to each child PR when it opens and unsubscribe when it merges.
