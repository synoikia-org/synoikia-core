---
name: change-workflow
description: >-
  How to carry a change from request to merged PR in the Synoikia plugins repo: size the task, go through plan
  mode for anything logical or big, propose a work pattern (one PR, or a chain of child PRs into an integration
  branch run unattended) for the user to approve, and suggest Auto mode for long runs. Use it at the start of
  every task that will change code, plugin.yaml, manifests, tests, CI or docs in this repo, even when the
  request is phrased as a question, a bug report or "just do X", and before writing a plan. Examples: add an
  operation, a lock or a sensitive field; fix a plugin's client or discovery; change a connection form; bump the
  SDK and core ranges; add a plugin; "can you clean up X". Use it alongside plugin-development, add-plugin or
  release-plugin, which say how to do the work itself. Not for questions that change nothing (explain, review,
  estimate), or for PR babysitting on a PR that already exists.
---

# Change workflow

This skill decides **how** a change gets done: which mode, which work pattern, and when to stop for the user. `plugin-development` says how the code looks, `add-plugin` how a new plugin starts and `release-plugin` how versions move.

## 1. Size the task before touching anything

| Small                                                            | Big or logical                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One concern in one plugin                                        | Several concerns, or more than one plugin                                                                                                                                                        |
| No change to what the plugin tells core, or one small, local fix | New operations or discovery, a refactor, a new plugin, an SDK or core range bump                                                                                                                 |
| No `test/__golden__/` diff, or a one-line fix with its test      | A lock, split, `sensitiveParams`/`sensitiveResult` or classification change in `plugin.yaml`; `network.hosts`, `sensitiveKeys` or the connection schema in `manifest.json`; `.github/workflows/` |
| Reviewable as one PR in one sitting                              | More than one PR's worth of review, or the work splits into steps                                                                                                                                |

Check the request against the repo while you size it (read-only): if the work is already done or the premise doesn't hold, say so with the evidence and ask what the user meant instead of planning it. If you're unsure of the size, treat it as big.

If the change needs something core doesn't offer (a new SDK helper, a harness feature, a gate behavior), stop: it is a `via-justa/synoikia-core` change, released first, then a range bump here. Say so instead of working around it in the plugin.

## 2. Big or logical: plan mode first

Enter plan mode (`EnterPlanMode`) before any edit, branch or commit, and stay there until the user approves the plan. Read-only exploration is fine before and during planning.

## 3. Propose a work pattern; the user approves it

Recommend one pattern, say why in a sentence, and get approval: in the plan for a big change, or with a short question (AskUserQuestion) for a small one. Don't start until the user picks.

**Single PR** (small changes):

- Work on the session's designated branch (restart it from `main` if its PR already merged), make the change, rebuild the touched plugin and run the repo's checks (`CLAUDE.md` › Commands), run the `security-reviewer` subagent when `CLAUDE.md` › Security review lists a path you touched, then push and open one draft PR into `main`.
- Bump a plugin's version only when the user asks (`release-plugin`). When the PR carries a bump and the repo releases on merge (`RELEASING.md`), say in its body that merging it publishes the release.

**PR chain, unattended** (big changes):

- An integration branch from `main` with a draft PR into `main`; that PR's body holds the progress table and the decisions log.
- One child branch and PR per step into the integration branch, merged (squash) after green CI, one at a time.
- One implementation subagent per step, so the main session only orchestrates and its context stays small.
- Stop only on blocking decisions; record everything else in the decisions log for the user to settle before the final merge.
- Never merge to `main`. The user merges the integration PR, and a version bump on `main` publishes.

**In both patterns, the PR into `main`** is opened as a draft and watched (`subscribe_pr_activity`) from the moment it opens until it merges or closes. Mark it ready for review (`update_pull_request` with `draft: false`) only when the work is done and CI is green on its current head. If a push after that turns CI red, fix it; don't leave a red PR marked ready.

Read `references/pr-chain.md` before starting a chain: it has the per-step loop, the PR body template, the blocking list and how to resume after an interruption.

## 4. Long task and not in Auto mode: suggest switching

A PR chain, or any task that will run for more than about an hour or across many tool calls, needs tool calls to run without a person approving each one. If the session isn't in Auto mode, say so before starting and suggest picking **Auto** in the mode menu next to the prompt box, so the chain doesn't stall on a permission prompt while the user is away. Don't switch it yourself.

## 5. Running unattended

- After every step, update the plan file's status section and the integration PR's progress table. They are the resume point after a usage limit or a restart.
- Subagents commit early, in coherent chunks, so an interruption loses little.
- PR events wake the session; don't poll. A one-time `send_later` check-in covers a lost event. Let a stale check-in fire and do nothing rather than deleting it.
- Subscribe to each child PR when it opens and unsubscribe when it merges. The PR into `main` stays watched until the user merges or closes it.
