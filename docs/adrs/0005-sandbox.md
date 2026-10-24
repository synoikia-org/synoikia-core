---
status: accepted
date: 2026-09-29
---

# A new isolate for each run

## Context and Problem Statement

`search(code)` and `execute(code)` run code that a model wrote. The model can be under prompt injection. Where does core run this code, and what can the code reach?

## Decision Drivers

- The code must reach upstreams only through the gate (ADR-0003).
- The code must never get a secret, the database or the host.
- A loop or a large value must not stop core.

## Considered Options

- A new `isolated-vm` isolate for each run, with only the bindings and JSON values across the boundary.
- The Node `vm` module.
- A child process for each run.

## Decision Outcome

Chosen option: "A new `isolated-vm` isolate for each run", because a V8 isolate has its own heap and no Node API. It also starts fast enough for each call.

- Core uses `isolated-vm` 6.2 with its prebuilt binaries. Node runs with `--no-node-snapshot`, which `isolated-vm` needs.
- Each `execute` and `search` gets a new isolate. Core disposes of it after the run and never uses it again.
- `code` is the body of an async function. It can `await` bindings and `return` a value that JSON can encode. All values cross the boundary as JSON.
- An error in the isolate comes back as `{ code, message }`. A binding error is an `Error` with `err.code` in the sandbox, so the code can catch it.
- **Available:** the binding functions, `catalog`, `registry` and `guides` (in `search` only), and `console.log`. Core captures the logs and returns them as `logs`.
- **Not available:** `require`, `import`, `process`, `fetch`, timers and host objects.
- **Host references.** A prelude script runs before the user code and keeps the host references in its closure. The user code is a separate script, so it cannot get them.
- The prelude freezes the binding namespaces and deletes `__syn` from the global object. The host calls only its own binding properties (`Object.hasOwn`).
- Core redacts the return value, each `console.log` argument and each error message before the model sees them (ADR-0007).

**Limits for each run.** An instance can change them.

| Limit       | Default | Notes                                                                                                         |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| Time        | 10 s    | Time that a binding waits for a human approval does not count. The CPU that the script uses meanwhile counts. |
| Memory      | 64 MB   |                                                                                                               |
| Result size | 64 KB   | A larger result comes back as `{ truncated, bytes, preview }`.                                                |
| Logs        | 16 KB   | In UTF-8 bytes. Each line counts at least 1 byte.                                                             |

The time limit stops synchronous loops (V8 timeout) and asynchronous loops (core disposes of the isolate). A parked execution (ADR-0006) keeps its isolate after the tool call answers, until the script ends.

### Consequences

- Good, because the code reaches nothing but the bindings, and each binding goes through the gate.
- Good, because a run cannot leave state for the next run.
- Bad, because `isolated-vm` is a native module. A Node upgrade needs its prebuilt binaries and `--no-node-snapshot`.
- Bad, because a parked execution holds an isolate in memory until its approval ends. The parked limits of ADR-0006 bound this.

The model view `execute` shows the sandbox. The feature file `@id:sandbox` specifies its behavior.
