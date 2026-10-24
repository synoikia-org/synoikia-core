---
title: Client auth
audience: admin
related: clients, user-auth
---

How MCP clients prove who they are.

## Client auth methods

Each endpoint accepts all enabled methods, unless its own settings limit it to some of them.

- **Bearer token**: clients send a token made under Clients & Tokens or on the profile of a user.
- **OAuth**: clients sign in through this server with a portal account, with OAuth 2.1 and PKCE. This is what claude.ai connectors expect.
- **External provider**: an identity provider in front of the MCP port signs clients in. Synoikia checks its signed assertion on each request.

## Clients

Allow or deny MCP clients by the name that they send when they connect, such as `claude-code`. Case does not matter. A change also ends the open sessions of a client that it refuses.

## Cloudflare Access

Each MCP request without a bearer token must carry a valid Cloudflare Access token. Synoikia checks it itself. The e-mail address of the token names the portal user. Service tokens are refused.
