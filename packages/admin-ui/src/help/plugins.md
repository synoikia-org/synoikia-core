---
title: Plugins
audience: admin
related: new-endpoint
---

A plugin describes the API of one kind of upstream service. Synoikia installs plugins from repositories or from a file.

## Repositories

A signed repository has a key. Synoikia checks each plugin against that key. When the key changes, plugin installs stop until you confirm the new key.

## Upload a file

A file upload replaces the repository version of that plugin. Use it to test a plugin before its release.
