---
title: New endpoint
audience: admin
related: connection, access
---

An endpoint exposes one upstream service as its own MCP server at its own path. Make one endpoint for each upstream that clients use.

## Before you start

- Enable the plugin for the upstream on the Plugins page.
- Get the address of the upstream and its credentials.
- Read the notes of the plugin under **Connection**. They say what the upstream needs.

## Plugin

The plugin knows the API of the upstream. The list shows only plugins that are enabled and ready to use. When there is only one, the page picks it for you.

## Path and display name

The **Path** is where clients reach the endpoint. It takes lowercase letters, digits and dashes, and starts with a letter or a digit. It must be free. Some paths are reserved for the server, such as `api`, `auth` and `oauth`.

The page fills in the path from the plugin. A change of the path later stops the clients that use it.

The **Display name** is the name that you see in the portal. Leave it empty to use the name of the plugin.

## Accepted client auth

**All enabled methods** accepts each sign-in method that is on under Settings, Client auth. **Only these** limits the endpoint to some of them. You can change this later on the Settings tab of the endpoint.

## Approve in the agent session

**Approve Ask operations in the agent session (form prompt or chat card)** is off by default. Leave it off unless you trust each client. When it is on, a client could approve its own calls, with nobody checking. Locked operations still need the approval page.

## Connection

The plugin decides the fields. Secrets are stored encrypted, and the portal never shows them again.

## After you create it

**Create endpoint** starts the endpoint and opens its Connection page.

- Each group starts at **Ask**. Reads run, and each write waits for your approval.
- Locked operations stay off.
- The first search of a client syncs the catalog first.

Then test the connection, set the levels on the Access page, and connect a client.
