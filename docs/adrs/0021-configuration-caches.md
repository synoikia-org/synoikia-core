---
status: accepted
date: 2026-10-23
---

# Configuration caches check write counters

## Context and Problem Statement

Each `execute` costs about 10 ms of core CPU. About 40% of it reads configuration from SQLite: the instance, its settings, the credential, the catalog version and the access levels. `search` reads the whole catalog of the instance, so its cost grows with the catalog. Core can keep this configuration in memory. But a change by the admin must apply at the next call, also in a session that is already open (ADR-0003, ADR-0010). How does a cache in memory stay correct?

## Decision Drivers

- A change of a level, a role, a credential, an instance or a sensitive key applies at the next call.
- A write path that forgets to invalidate must not keep stale permissions.
- The writes on each call, such as audit rows and rate counters, must not empty the caches.

## Considered Options

- Counters of writes for each table, kept by the database layer.
- Explicit invalidation in each service that writes.
- A short time to live.

## Decision Outcome

Chosen option: "Counters of writes for each table", because no service has to remember to invalidate.

- Core writes to the database only through the database layer (`db/`). The layer counts each insert, update and delete for the table that it changes. A write in raw SQL also goes through the layer and names its tables.
- A cache keeps the counters of the tables that it read. At each read it compares them with the current counters. If one moved, it reads the tables again.
- A value that depends on the time is cached without the decision. For example, a cached credential keeps its expiry, and core compares the expiry with the clock at each call.
- Each component caches the data that it owns: Auth the credentials, the instance manager the instances and their settings, and catalog sync the catalogs with their access levels. The server settings are cached in the same way, and core freezes them because callers share them.
- Hot queries that stay on the call path, such as the audit insert, use prepared Drizzle queries.
- A statement that may write but names no table that the layer knows counts as a write to every table, so the counters fail closed.
- The cached runtime of an instance keeps its redactor, which holds the decrypted secret values of the instance until the instance is written. ADR-0016 already accepts secrets in the memory of core.

Core is one process, and it holds a lock on its data folder. A change from another process, such as the `sqlite3` shell or `rotate-master-key --force`, applies only after core restarts.

### Consequences

- Good, because a change applies at the next call without code in each write path.
- Good, because audit and rate writes change only their own tables, so the caches stay warm.
- Bad, because a write that does not go through the database layer leaves a cache stale. Code review and the scenarios for open sessions must catch it.
- Bad, because the caches hold the catalogs in memory, a few MB for large catalogs.

The model view `coreComponents` shows the caches and the database access component.
