---
status: accepted
date: 2026-10-23
---

# An idle instance stops until its next call

## Context and Problem Statement

Core keeps a child process for each enabled instance (ADR-0014). An SDK plugin child costs 20 to 23 MB of memory, also when nobody calls it. The children use most of the memory of core. Can an instance stop when nobody uses it, and keep the guarantees of ADR-0014?

## Decision Drivers

- A call still goes through the gate, and fails closed when the plugin cannot run.
- Only the plugin knows whether it keeps a live connection, a subscription, or feeds notifications.
- An idle stop must not end approvals, parked executions or session grants.

## Considered Options

- The plugin says that it may stop, and core decides when the instance is idle.
- The admin turns idle stop on for any plugin.
- Every instance stays running.

## Decision Outcome

Chosen option: "The plugin says that it may stop, and core decides when the instance is idle".

- **Manifest.** The top-level field `lifecycle` is `always` (default) or `on-demand`. It only describes the plugin. The gate, the sandbox, the approvals, the redaction and the auth never read it. A plugin that sets `on-demand` falsely only loses its own background work, and one that omits it stays running.
- **Setting.** The instance setting for the idle time is 10 minutes by default, at least 5 minutes, or always on. Only an `on-demand` plugin stops, and the Admin API refuses an idle time for any other plugin. The Admin API writes it, with a `config` audit event.
- **Idle.** Core alone decides that an instance is idle. It needs no call for the idle time, no call in flight, no open approval, no parked execution and no running sync. The plugin host then stops the child and sets the status `idle`. `idle` is not `stopped` and not `error`. It ends no approval, parked execution or session grant, and sends no notification (ADR-0019). A child that exits on its own is still a crash.
- **Cold start.** `search` uses the stored catalog while the instance is idle. A call that needs the plugin starts it, and all callers wait on that one start. That is an `execute`, a guide read, an option list of the portal or a sync. The wait of an `execute` does not count against the sandbox time limit. Each start reads the bundle version before the fork and sends the secrets only in `init`, as in ADR-0014. If the bundle version changed, or the upstream version is unknown, the catalog syncs before the call runs. Until the sync ends, the catalog version stays unknown.
- **Failure.** A start that fails sets the status `error`, fails the call with `PLUGIN_UNAVAILABLE`, and follows the back-off of ADR-0014. A call during the back-off fails at once and starts nothing.
- **Order.** The idle stop, the cold start, and the stop, start and restart of the admin run one at a time, as in ADR-0014.

### Consequences

- Good, because an instance that nobody calls costs no child process.
- Good, because the gate and the version check stay the same for each call.
- Bad, because the first call after an idle stop waits for the start, about half a second to a second.
- Bad, because a plugin that keeps a connection must stay `always`, and the admin cannot change that.

The model view `coreComponents` shows the plugin host and the instance manager.
