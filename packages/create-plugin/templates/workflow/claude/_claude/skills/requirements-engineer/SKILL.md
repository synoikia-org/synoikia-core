---
name: requirements-engineer
description: >-
  Turn a rough idea, a bug report or existing behavior into a Gherkin feature file by interviewing the user one
  scenario at a time, and cut it into thin slices. Use it to specify what to build before any design or code,
  and to backfill a spec for behavior that exists already.
---

# Requirements engineer

**In:** a rough idea, a bug report, or a part of the design document to backfill.
**Out:** a feature file in `features/<domain>/<feature>.feature` and a `spec:` commit.

The feature file rules are in `docs/workflow.md` › Feature files. Read them first.

## Requirements come from the user

Ask for the requirements. Do not invent them, and do not read them out of the code. Code shows what exists, not what should exist. A spec copied from code keeps its accidents.

In **backfill** mode, the design document and the existing tests are the source. Turn each statement into a scenario and show it to the user. The user confirms, changes or removes it. Label the pull request `backfill`.

## Plan wide, build small

Specify as much as the user wants. Before the push, the user selects the slice to build next: one rule, three scenarios at most. Tag every other scenario `@backlog`.

Recommend the thinnest slice yourself, and say what you left out:

- **The simplest case first.** One actor, one value, the case that ends well.
- **One rule.** Include the case that it refuses, because that case states the rule.
- **The extras last.** Speed, configuration and rare edges are slices of their own.

Split further by SPIDR: spike, path, interface, data, rules.

Put everything the slice does not need in a `@backlog` scenario. Nothing gets lost, and nothing rides along.

## One scenario at a time

Never write a second scenario before the user agrees the first. A file with scenarios the user has not seen one by one is a guess.

1. **Find where it lives.** Read the `features/` folders first. If a feature covers the behavior already, extend that file.
2. **Get one example.** Ask what happened, or what would happen: who did what, to what, and what they saw. Write it with its values. Then find the wording that makes it general.
3. **Ask what else is true.** Ask for the case that is refused, the case where nothing arrives, and the case that goes the other way. A slice where every scenario ends well states no rule.
4. **Ask only what the product does.** The folders and the wording are yours. How it gets built is the architect's.

## The World

The World is the set of synthetic things that the scenarios run in: instances, plugins, agents, roles and their values. Build it in the first slices and grow it slice by slice. People appear by role or by a made-up number, never by a real name. Later scenarios name the World's things, never placeholders.

## Changing a rule

When you remove or loosen a rule, list every scenario, skill line and document that names it. Change them all in the same slice. Ask the user whether stored data breaks under the new rule.

## Push

Read the file again against the rules and ask about what you find in one last round. When the user agrees, commit as `spec: …`, push and open a draft pull request.

## Done when

No question is open, the user agrees the spec, and the user selected the slice to build.
