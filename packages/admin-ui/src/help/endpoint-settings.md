---
title: Endpoint Settings
audience: admin
related: rules, access
---

The name, path and limits of one endpoint.

## Path

The path is where clients reach the endpoint. When you change it, clients that use the old path stop working.

## Session approvals

While a session approval is active, each **Ask** operation of that client on this endpoint runs without asking. Locked operations and operations that need a typed confirmation still ask. A length of 0 turns session approvals off.

## Redaction

The keys you add here are hidden in audit logs, approvals and results, on top of the sensitive keys of the plugin.
