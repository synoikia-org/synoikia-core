---
title: Notifications
audience: admin
related: server-settings
---

Notifications keep you informed. They carry summaries, never parameters or secrets. Approvals happen in your MCP client, which opens the approval page.

## ntfy topics

On a public ntfy server, anyone who knows the topic can read it. Pick a topic that nobody can guess.

## Webhooks

A webhook with a secret gets a signature header. The header is `x-synoikia-signature`, an HMAC with SHA-256 of the timestamp and the body.
