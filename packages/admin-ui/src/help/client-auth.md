---
title: Client auth
audience: admin
related: clients, user-auth
---

Use this page to decide how MCP clients connect to your endpoints. Client auth decides only who can connect. The access levels of each endpoint and the role of the user decide what a client may do.

Each call runs as a portal user. A bearer token runs as its owner. An OAuth client runs as the person who gave consent. An **External** client runs as the user that the provider names.

## Pick the client auth methods

A new server has **Bearer tokens** and **OAuth** on, and **External** off. Keep at least one method on. Without one, no client can connect, so the page does not save.

- **Bearer tokens**: pick this for scripts and for clients that take a fixed header. You make the token under Clients & Tokens.
- **OAuth**: pick this for claude.ai, Claude Desktop and Claude Code. The person signs in once in a browser and picks **Read only** or **Read & write**.
- **External**: pick this when Cloudflare Access already protects the MCP port and signs people in.

When you turn a method off, every endpoint stops accepting it. Clients that use it can no longer connect.

## Limit one endpoint to some methods

Open the endpoint, then its Settings tab. Under **Accepted client auth**, choose **Only these** and select the methods.

An endpoint can only accept fewer methods than this page enables. If no accepted method is on here, the endpoint refuses every call. The Connection tab of the endpoint then shows a warning.

## Connect claude.ai with OAuth

1. Make sure the server has `PUBLIC_MCP_URL`. Without it, the OAuth card warns that OAuth is off.
2. Keep **OAuth** on, and keep **Let MCP clients register themselves** on.
3. Copy the endpoint URL from the Connection tab of the endpoint.
4. In Claude Desktop, open **Settings → Connectors** and choose **Add custom connector**.
5. Paste the endpoint URL as the server URL, then choose **Add** and **Connect**.
6. Sign in to Synoikia in the browser.
7. Pick the endpoints and **Read only** or **Read & write**.

The connector then also shows on claude.ai. **Read only** is the default, and a client with it never writes. To change it later, revoke the grant under Clients & Tokens and connect again.

## Register OAuth clients yourself

Turn off **Let MCP clients register themselves** to stop unknown clients from registering. Then register each client under Clients & Tokens, with its redirect URIs.

A Cloudflare MCP portal with **Automatic** OAuth credentials registers itself. It needs this switch on.

## Set how long OAuth sign-ins last

**Access token lifetime (minutes)** is between 5 and 1440, and 60 by default. **Refresh token lifetime (days)** is between 1 and 365, and 30 by default.

The client renews its access token with the refresh token, and the refresh token changes at each use. A client that does not renew within the refresh lifetime must sign in again.

## Put Cloudflare Access in front

Turn on **External**, pick **Cloudflare Access**, and follow the steps on the Cloudflare Access card. Then enter the **Cloudflare team domain** and the **Application audience (AUD)**, and save.

- The e-mail address in the Cloudflare Access token names the portal user. Add each person on the Users page with their e-mail address as the username.
- A user who made their own account on the sign-in page, or who came from single sign-on, never matches.
- An unknown address gets an account only while User auth has a default role for new accounts. That account gets the default role.
- Service tokens are refused.
- An **External** client has no **Read only** choice. It reaches all the levels of the user.
- A request with a bearer token still uses **Bearer tokens**, if the endpoint accepts them.

The person approves calls on the approval page with the same Cloudflare Access identity. A client that holds that identity could open the approval link itself. Approvals then protect against agent mistakes, not against a hostile client.

## Allow or deny clients by name

Under **Clients**, choose **Allow only these clients** or **Deny these clients**, then add the names. Names do not depend on case, and the list holds up to 50 names.

**Seen since the server started** lists the names that connected. Choose **Add** next to a name to put it on the list.

A client sends its own name, so any client can send any name. Use the list to stop honest clients that you do not want. It is not a security boundary.

When a change refuses a client, its open sessions end. They do not come back when you turn the policy off. An empty allow list refuses every client, so the page does not save it.

## When a client cannot connect

- The client finds no OAuth sign-in: check `PUBLIC_MCP_URL`, and check that the endpoint accepts **OAuth**.
- The client cannot register: turn on **Let MCP clients register themselves**, or register the client under Clients & Tokens.
- The browser shows "Invalid redirect": the client used a redirect URI that it did not register.
- The consent page says that no requested endpoint is available: the role of the person does not have that endpoint.
- The consent page asks to set up an authenticator app: User auth requires two-factor authentication for password sign-in.
- The consent page says that the session expired: the person waited more than 10 minutes, or changed browser. Start again from the client.
- An **External** client gets no account match: check the username on the Users page, and the default role on User auth.
- A client says that the app is not allowed: check the client names under **Clients**.
