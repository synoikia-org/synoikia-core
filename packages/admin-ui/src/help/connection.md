---
title: Connection
audience: admin
related: endpoint-settings, access
---

This page connects the endpoint to its upstream service. Here you change the address and the credentials, sync the catalog, and set up a client.

## Change the connection

1. Change the fields. The plugin decides which fields there are.
2. Choose **Test connection**. It tests the values in the form, without a save.
3. Choose **Save** when the test works.

A save restarts the endpoint with the new connection. The test does not touch the running endpoint.

## Secrets

The page never shows a stored secret. It shows **Set** and the last characters.

- **Replace** opens a box for a new value. **Keep current** closes it again.
- **Clear** removes the secret at the next save. **Undo** keeps it.

Secrets are stored encrypted. The audit log names a changed secret, but never its value.

## When the connection fails

**Test connection** says why the test failed. Check these points:

- The server of this portal can reach the address. Your browser is not the one that connects.
- The credentials have the rights that the **Setup notes** name.
- Too many tests from your address are refused for a time, as sign-ins are.

An endpoint that cannot reach its upstream tries again to start. The error shows under the page header until a start works.

## Catalog

The catalog is the list of operations that the plugin found on the upstream. **Sync now** reads it again. It works only while the endpoint is ready.

The endpoint also syncs on its own. It syncs when a session starts and the catalog is old, once a day, and when the upstream version changes.

A sync never gives a client more access. New writes wait for you on the Access page.

A failed sync keeps the last good catalog, and the endpoint stays ready. **Last sync** then shows **failed**. A failed first sync shows an error on the endpoint until a sync works.

## Setup notes

The plugin gives these notes. They say what the upstream needs, such as an API key and its rights.

## Connect a client

1. Pick your client in **Connect a client**.
2. Copy the **Endpoint URL**.
3. Follow the steps for the sign-in method in **Sign in with**.

The steps change with the sign-in methods that the endpoint accepts. Change them on the Settings tab of the endpoint.

The server may not know its public address. Then set `PUBLIC_MCP_URL` and use your real host in place of `<your-mcp-host>`.

A client that signs in as **Read only** cannot write at any level. Calls that ask send you to the approval page.
