---
status: accepted
date: 2026-10-21
---

# Security lives in core, once

## Context and Problem Statement

Synoikia puts many self-hosted services behind one MCP server. Each service has a plugin, and plugins come from many authors. A model writes the code that calls a service. Where are the decisions about what may reach a service?

## Decision Drivers

- A plugin author can make a mistake, or a plugin can be malicious.
- The model can be under prompt injection.
- An admin must be able to trust one set of controls for all services.

## Considered Options

- Core makes every security decision, and a plugin only describes its upstream.
- Each plugin makes its own security decisions.

## Decision Outcome

Chosen option: "Core makes every security decision", because one gate, sandbox, approval flow, redaction and audit log cover every plugin the same way.

These rules follow from it:

- **Security is in core, once.** Core makes every decision about what can reach an upstream. A plugin only describes its upstream. A plugin can give core wrong data, but it cannot skip the gate.
- **Fail closed.** If core cannot make a decision, it refuses the call or hides the operation.
- **A human approves, not the client.** A risky call needs a decision from a signed-in human on a page that core shows. The answer of the calling client is not an approval.
- **Secrets stay out of the sandbox.** Upstream credentials are encrypted at rest. The API does not return them. The sandbox never gets them.
- **Everything is audited.** Core writes each call, search, configuration change, sign-in failure and plugin event to the audit log.

### Consequences

- Good, because a plugin needs no security code, and a review of core covers every plugin.
- Bad, because a plugin that gives core wrong classifications or locks can still expose its own upstream. The trust boundaries ADR lists this risk.

The model views `containers` and `coreComponents` show the parts that make these decisions.
