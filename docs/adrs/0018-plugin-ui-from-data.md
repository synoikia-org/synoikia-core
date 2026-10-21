---
status: accepted
date: 2026-10-07
---

# Plugin UI from data

## Context and Problem Statement

Each plugin needs forms in the admin portal: its connection form, and the fields of its pre-approval rules. The portal holds an admin session that can change every security setting. How does a plugin get its forms without code in the portal?

## Decision Drivers

- No plugin code may run in the admin portal.
- A secret field must never show its value.
- An unknown widget must fail, not fall back to a free-text field.

## Considered Options

- JSON Schema and UI hints from the manifest, shown by a fixed widget library in core.
- Plugin web components or scripts in the portal.

## Decision Outcome

Chosen option: "JSON Schema and UI hints, shown by a fixed widget library in core". Plugins never send JavaScript to the portal.

| Widget                                    | Use                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`, `url`, `number`, `bool`, `select` | Connection fields, simple match fields                                                                                                                                                                                                            |
| `secret`                                  | Write-only credential fields: a hint and "Rotate"                                                                                                                                                                                                 |
| `multiselect`                             | Fixed options, or options from `optionsFor(source)`                                                                                                                                                                                               |
| `prefix`                                  | A path or name prefix                                                                                                                                                                                                                             |
| `range`                                   | A number range with a unit                                                                                                                                                                                                                        |
| `registry-picker`                         | A `$targets` selector from the plugin `targets` (ADR-0011): one chips input for each scope that the field offers, with suggestions from the registry, and one for target ids. It uses `GET /api/instances/:id/registry?kind=&text=&scope.<key>=`. |
| `diff`                                    | The before and after values on the approval page                                                                                                                                                                                                  |

- A new widget is a core change. A manifest with an unknown widget name is not valid, so a plugin cannot fall back to a free-text field without notice.
- `showWhen: { field, in: [...] }` shows a connection field only for some values of another field.
- `connection.help` (Markdown) shows above the form as setup steps.
- Conditional requirements use JSON Schema (`allOf` with `if` and `then`). The server validates them.

### Consequences

- Good, because the admin session never runs plugin code.
- Good, because each secret field uses the same write-only widget.
- Bad, because a plugin that needs a new kind of field must wait for a core release.

The feature files `@id:plugin-manifest` and `@id:portal-instances` specify its behavior.
