---
status: accepted
date: 2026-09-29
---

# Redaction everywhere a value leaves core

## Context and Problem Statement

Upstream results, call parameters and error messages can hold secrets. The model, the audit log, the approval page and the portal show these values. How does core keep secrets out of what it shows and stores?

## Decision Drivers

- A secret must never reach the model, even when the plugin forgets to declare it.
- The audit log and the approval page must show enough to decide and to review.
- The upstream must still get the real values.

## Considered Options

- Core redacts by key name, by declared paths and by the actual secret values, at each place where a value leaves core.
- Each plugin redacts its own results.

## Decision Outcome

Chosen option: "Core redacts at each place where a value leaves core", because a plugin can forget a field, and one redactor in core covers every plugin.

Core replaces values with `"[REDACTED]"` in results, parameters, summaries and diffs. Keys match these lists:

- The global list: `password`, `passphrase`, `secret`, `token`, `apiKey`, `privateKey`, `bindpw`, `authPass`, `accessToken`, `refreshToken`, `clientSecret`, `authorization`, `credential`, `cookie`, `passwd`, `pass`, `pwd`.
- The `sensitiveKeys` of the plugin.
- The extra keys of the instance, set in the portal.

**Key matching.**

- Keys match without regard to case, and `_` and `-` are ignored.
- A key matches a rule if it is equal to it or contains it (`db_password`, `X-Api-Key`, `ssh_private_key`).
- A rule shorter than five characters (`pass`, `pwd`) matches only as the last word of a key (`smtp_pass`). So `bypass` stays visible.
- For a key that only contains a rule, booleans and numbers stay visible (`password_set: true`, `max_tokens: 4096`).

**Secret parameters without a key name.** A descriptor declares these as `sensitiveParams`: JSON pointers into the parameters (`/1`, `/0/password`). Core replaces them wherever it shows or stores parameters. `invoke` gets the real values.

**Secret results without a key name.** A descriptor declares these as `sensitiveResult`:

- `'whole'`: the full result is a secret.
- `{ keys, deep? }`: each non-empty value under one of these exact key names, in the result or in each row of it. With `deep`, at any depth. A value deeper than 16 levels is hidden too.

Core stores the declaration with the operation. It applies it to the raw `invoke` result first, then applies the instance redactor. Nothing else sees the raw result. The SDK function `maskSensitiveResult` does this masking, and core calls it.

One case stays in the plugin: a result that holds the results of other operations, for example the records of a job queue. The plugin masks each record with the rule of its own operation (`rules.maskEmbeddedResult`).

**Diffs.** A `prepareWrite` diff names each changed field in a path (`/smtp/password`). Key redaction does not see this. So core hides `before` and `after` of an entry if its path has a sensitive segment, or is at or below a `sensitiveParams` path.

**Secret values in text.** Text has no keys. So each instance redactor also removes the actual secret values of the instance from each string. It also removes their URL-encoded and JSON-encoded forms, if they have 6 or more characters.

**Where redaction applies.**

- Values that go to the model: the sandbox result (before core truncates it), each `console.log` argument, and error messages.
- `registry.find` results, at the source.
- Plugin and upstream error messages, before they reach the model.
- The audit log and pending approvals.
- The portal.

### Consequences

- Good, because a secret that the plugin did not declare is still hidden when its key name or its value matches.
- Good, because the approval page and the audit log show the same redacted values.
- Bad, because a key such as `token_count` with a string value is hidden, although it is not a secret.
- Bad, because an operation that embeds the results of other operations needs the plugin to mask them.

The feature file `@id:redaction` specifies its behavior.
