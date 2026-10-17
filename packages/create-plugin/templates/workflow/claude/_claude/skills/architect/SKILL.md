---
name: architect
description: >-
  Plan the build and place it in the LikeC4 model in docs/architecture, by interviewing the user on each design
  decision, layer by layer in arc42's views. Use it after the spec and before code, for every task. It replaces
  plan mode: its build plan says which slices come in which order.
---

# Architect

**In:** the feature files of the task, with the first slice selected.
**Out:** the build plan, and the task placed in the LikeC4 model in `docs/architecture/` with an `arch:` commit.

Write only the model and the plan. Do not write code or diagram files.

1. **Read the model.** If there is no model, this slice starts it, with just enough to place the slice.
2. **Ask the design into the model, layer by layer.** Follow arc42's order: context and scope, then the building blocks level by level, then deployment. Ask in rounds, as `change-workflow` says. Write each answer into the model before the next round.
3. **Send behavior questions back.** A question about what the product does belongs to the spec. Return it to `requirements-engineer`. Do not settle it in the model.
4. **Write the build plan.** List the slices in order. For each slice, give its rule, the parts of the model it changes, and the slices it needs first. Name the existing code that each slice reuses or extracts. Ask the user about the order in one last round.
5. **Push.** When no question is open and the user agrees, commit the model as `arch: …` and push. Put the build plan in the pull request description. Later slices update the plan in their own pull requests.

## Rules for the model

- Views follow arc42. Goals and quality live in the feature files.
- A box with parts of its own gets a view at the next level.
- A building-block view holds its subject's children and their direct neighbors. An element appears at one level only in a view.
- Add a dynamic view only for a complex sequence: many elements, an order that matters, an asynchronous hand-off or a failure path. Never add one for each scenario.
- **State a fact once.** A description says what an element is, in one sentence. What it does to another element is a relation. How a story runs is the feature file.
- Applications share no storage. One application reaches another only through its API.
- Model your own parts. A library you use is a technology line. A package you write is a `library` element.
- Names come from the field's standard. Ask, as `change-workflow` says.
- The design document links the views. It does not repeat them.

## Layout

- `likec4.config.mjs`: the project and its summary.
- `models/base-model.c4`: element kinds, people, external systems, the system and its applications.
- `models/<part>.c4`: one file for each container or package. Each file extends its parent.
- `models/deployment.c4`: where each part runs.
- `views/views.c4`: every view.

## Done when

No question is open, the user agrees the build plan, and the model places the next slice.
