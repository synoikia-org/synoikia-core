# PR chain, unattended

How to run a big change as a chain of child PRs into one integration PR. The user approved this pattern in plan mode; the plan lists the steps.

## Branches

Names follow `SKILL.md` › Branch names.

- **Integration branch** `<component>/<task-summary>` (e.g. `core/auth-refactoring`), from `origin/main`, pushed at the start. Open a **draft** PR from it into `main` right away and subscribe to it; it carries the progress table and decisions log (template below).
- **Child branches** `<component>/<task-summary>-<step>` (e.g. `core/auth-refactoring-session-store`), each from the current integration head, after the previous child merged.
- Keep the integration branch **linear**: only squash-merged children land on it. Don't use "Update branch" (it adds a merge commit), and don't build it on top of an unmerged PR. If `main` moves, rebuild the integration branch on `main` (cherry-pick the step commits) before the final merge, so the user can **Rebase and merge** it.
- Versions are bumped once, in the last step.

## The loop, per step

1. Start an implementation subagent (background) with: the plan file path and its step, the branch to create, the skills to load (`vue-development`, `core-development`), the repo checks to run, "commit early, don't push, don't open a PR", the commit trailer lines, and a report format (files, checks, decisions to record, blockers, under ~300 words).
2. When it reports, run the step's checks the main session owns:
   - UI changes: a visual comparison against `main` when the plan promised no visual change.
   - The `security-reviewer` subagent when `CLAUDE.md` › Security review lists a touched path.
   - Send findings back to the same subagent to fix.
3. Push, open the child PR into the integration branch, `subscribe_pr_activity`, and arm one `send_later` check-in.
4. On green CI: squash-merge, `unsubscribe_pr_activity`, sync the local integration branch, update the progress table, the decisions log and the plan's status section.
5. On red CI: root-cause and push a fix (or send it to a CI-fix subagent). Never skip or loosen a test.

## Blocking vs recorded

Stop and ask the user (post it under "Blocking" in the integration PR too) when:

- a change the plan ruled out becomes necessary (a visual change, a behavior change a test proves);
- a security finding can't be fixed inside the step;
- CI stays red after a root-cause attempt;
- a merge conflict where both sides changed the same logic.

Everything else (naming, a pre-existing bug found in passing, a fix left out, a side effect worth knowing) goes in the decisions log and work continues.

## Integration PR body

```markdown
## What / why

<goal, constraints, what "done" means>

## Progress

| #   | Branch                              | PR  | State                                       |
| --- | ----------------------------------- | --- | ------------------------------------------- |
| 1   | `<component>/<task-summary>-<step>` | #n  | merged / CI running / in progress / pending |

## Decisions log

### Blocking (needs an answer before work continues)

### For review before merging to main

**Step 1 (#n)**

- ...

## Testing

<filled in at the end>
```

## Resume after a usage limit or restart

Read the plan file's status section, then check the repo: which child branch exists, whether it has commits, whether its PR is open, merged or red. Re-dispatch a subagent that stopped partway with "the branch exists; finish it", not a fresh start.

## Finish

1. A security review of the whole integration diff, plus a final visual run when the plan promised one.
2. Line counts before and after, test counts, and the open decisions list in the integration PR body.
3. When CI is green on the integration PR's head, mark it ready for review and keep watching it. Don't merge it; tell the user the merge method that keeps the step commits (Rebase and merge) and what it needs.
