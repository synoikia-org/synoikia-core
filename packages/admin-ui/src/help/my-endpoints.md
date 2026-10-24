---
title: My endpoints
audience: everyone
related: my-endpoint, profile
---

Use this page to connect your MCP clients to the endpoints that your role gives you. Each endpoint reaches one upstream service.

Select the path of an endpoint to see what you can call there.

## Connect a client

The **Sign-in** column shows how a client can sign in to each endpoint.

With **OAuth**:

1. Choose **Copy** next to the URL of the endpoint.
2. Add that URL to your MCP client as a remote HTTP server.
3. Start the sign-in in your client. A browser opens.
4. Sign in to Synoikia and choose **Read only** or **Read & write**.

With **Bearer tokens**:

1. Make a token under **My profile**, for this endpoint.
2. Add the URL of the endpoint to your MCP client as a remote HTTP server.
3. Add the header `Authorization: Bearer` followed by your token.

With **External**, follow the steps for **OAuth**. You sign in through the access gateway in front of the server.

Keep a token out of shared files. Anyone with it acts as you.

## Approve the calls of your clients

A call that needs approval opens the approval page in your browser. Only you can approve the calls of your own clients.

The first approval can ask you to sign in on that page. The browser then approves without a new sign-in for some hours. See **Approval browsers** on **My profile**.

## When a client is refused

- **Invalid or expired token**: the token is wrong, revoked or past its expiry. Make a new token.
- **This token is not valid for this endpoint**: the token is for other endpoints, or your role lost this one.
- **This token was not granted for this endpoint**: the OAuth sign-in of the client was for other endpoints.
- **This endpoint does not accept that kind of token**: use a sign-in method from the **Sign-in** column.
- **This MCP client is not allowed on this server**: an administrator limits which clients may connect.

A red mark in the **Sign-in** column means that the endpoint refuses every client. Ask an administrator to fix it.

## When a call is refused

A refused call names the reason. Open the endpoint here to see the level of each operation. An operation at **Off** cannot be called.

A **Read only** token or connection cannot run writes. Make a **Read & write** token if you need writes.

## Check the status of an endpoint

Your role can let you see the status of its endpoints. A **Status** column then shows whether each endpoint runs, and when it last synced. An endpoint in error or disabled cannot take calls.

## Endpoints you cannot reach

Your role can let you see other endpoints by name, under **Unassigned endpoints**. Open one to see what it is. Ask an administrator if you need access to it.

## What users of a role see {admin}

Each role has switches on each of its endpoints, under **Roles** in the settings.

- **See endpoint status**: shows the **Status** column.
- **Set personal levels**: lets users lower levels for their own clients.
- **Own pre-approval rules**: lets users keep their own rules.

**See other endpoints** on a role lists the other endpoints by name and description, without access.
