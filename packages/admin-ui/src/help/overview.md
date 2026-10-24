---
title: Overview
audience: admin
related: new-endpoint, plugins
---

Use this page to check that each endpoint runs and that clients can reach it. Start here when a client reports a failed call.

Each row is one endpoint. Select its path to open its own pages and fix it.

## What the status means

- **ready**: the plugin runs and takes calls.
- **starting**: the plugin process starts.
- **idle**: nobody called the endpoint for its idle time, so its plugin stopped. The next call starts it again.
- **stopped**: the plugin does not run. A disabled plugin stops all its endpoints.
- **error**: the plugin could not start or could not read its operations. The text under the status gives the reason.
- **disabled**: you turned the endpoint off on its **Settings** tab.

## When an endpoint shows an error

The server starts a failed plugin again by itself. The pause between tries grows with each failure.

1. Read the error under the status. An error that starts with `init failed` means the plugin could not start.
2. Select the path of the endpoint. Its **Connection** page opens.
3. Choose **Test connection** to see if the upstream service answers.
4. Correct the address or the credentials, then choose **Save**. The plugin starts again with the new connection.
5. If the error stays, open **Plugins** and check the status of the plugin.

Secrets in an error show as `[REDACTED]`.

## When the last sync failed

A **failed** mark under **Last sync** means that the endpoint could not read its operations from the upstream service. The endpoint keeps the operations of its last good sync.

The server syncs again when a client session starts after an hour, once a day, and when the upstream version changes. To sync at once, choose **Sync now** on the **Connection** page of the endpoint.

## When an endpoint refuses every call

The **Auth** column lists the client auth methods that the endpoint accepts. A red mark means that it accepts none, so it refuses every client.

Turn on a method under **Settings**, **Client auth**. Or let the endpoint accept more methods on its own **Settings** tab.

## When a plugin has a problem

A **Plugin problems** alert names each plugin that the server cannot run. Its endpoints cannot start. Open **Plugins** to see the reason and fix it.

## Warnings at the top

A warning comes from the last start of the server. It stays until the next start. Examples are a master key kept inside the data volume, or a plugin with an id that is already taken.

Most warnings name a setting of the server environment. Change it there and restart the server.

## Give a client the address of an endpoint

Choose **Copy URL** on the row of the endpoint. The address uses `PUBLIC_MCP_URL`. Without it, the addresses are not the public ones, and OAuth sign-in is off.

## Add an endpoint

Choose **New endpoint**. You can add an endpoint only from an enabled plugin. Install and enable plugins on the **Plugins** page.
