# Synoikia software design description

This document set is the software design description (SDD) of Synoikia core. It tells what the system does and how its parts do it. It describes the current design only.

## Document rules

- The text uses ASD-STE100 Simplified Technical English. Sentences are short and in the active voice. Each sentence gives one instruction or one fact.
- Each term in the glossary has one meaning. The text does not use other words for these terms.
- Code names (`syncCatalog`, `plugin_instances`) and file paths are technical names. They do not change.
- The documents describe the current design. They do not describe earlier designs, changes, or migrations.
- Section numbers do not change. Code comments refer to them, for example `design §6.2`.
- The feature files specify the behavior. A section describes the design and links the feature files of its behavior, by their `@id`. A code comment on behavior that no section describes cites the `@id`.

## Sections

| Section | File                                             | Subject                                                   |
| ------- | ------------------------------------------------ | --------------------------------------------------------- |
| §2      | [02-topology.md](02-topology.md)                 | Process, listeners, endpoint routing                      |
| §3      | [03-plugin-model.md](03-plugin-model.md)         | Responsibilities, manifest, RPC contract, operation rules |
| §4      | [04-plugin-lifecycle.md](04-plugin-lifecycle.md) | Installation, repositories, signatures, isolation, tests  |
| §6      | [06-authentication.md](06-authentication.md)     | Portal sign-in, client auth, access ceiling               |
| §7      | [07-data.md](07-data.md)                         | Tables, secrets, write ownership                          |
| §8      | [08-admin-portal.md](08-admin-portal.md)         | Pages, plugin UI, Admin API                               |
| §9      | [09-notifications.md](09-notifications.md)       | Notification channels and events                          |
| §10     | [10-maintenance.md](10-maintenance.md)           | Catalog sync and housekeeping                             |

The architecture model is in [`../architecture/`](../architecture/README.md). Its views show the structure of the system. The security decisions are ADRs in [`../adrs/`](../adrs/). The glossary, the limits and the environment are in [`../reference.md`](../reference.md). The plugin author guide is [`../plugin-authoring.md`](../plugin-authoring.md).
