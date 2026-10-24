---
title: Clients & Tokens
audience: admin
related: client-auth, users
---

Use this page to give a script or a client a bearer token, to register OAuth clients, and to take access away. Settings → Client auth decides which of these methods the endpoints accept.

Every credential acts for one user, within the role of that user. A credential never reaches more than its user can reach.

## Give a script a bearer token

1. Choose **New token**.
2. Enter a **Name** that tells you where the token is used.
3. Under **Endpoints**, select the endpoints, or **All endpoints, including future ones**.
4. Under **Access**, keep **Read only**, or pick **Read & write** if the script must change things.
5. Optionally, set **Expires**.
6. Choose **Create token**, then copy the token.

The token shows only once. If you lose it, revoke it and make a new one. The script sends it in each request as `Authorization: Bearer <token>`.

## Who a token acts for

A token that you make here belongs to you. The **Owner** column shows this. Its calls use your levels, and you approve the calls that ask.

To give another person a token, let them make it. Each user makes their own tokens on My profile, under **My tokens**. Their tokens reach only the endpoints of their role, and only they approve the calls.

A token stops working when its owner is disabled or deleted. A new password does not end bearer tokens.

## Choose the access of a token

**Read only** never writes, whatever the access levels of the endpoint allow. **Read & write** writes only where the levels of the endpoint and the role allow writes.

With **All endpoints, including future ones**, the token follows the role of its owner at each call. It reaches each new endpoint of that role at once, at the levels in force.

You cannot change a token after you make it. Make a new token, then revoke the old one.

## Revoke a token

Choose **Revoke** on its row and confirm. Clients that use it lose access immediately. To see revoked tokens, clients and grants again, select **Show revoked**.

## Register an OAuth client

Most clients register themselves on first connect. Register a client here only when **Let MCP clients register themselves** is off under Settings → Client auth.

1. Choose **Register client**.
2. Enter a **Name**.
3. Enter the **Redirect URIs (one per line)** that the client uses. For claude.ai, use `https://claude.ai/api/mcp/auth_callback`.
4. Select **Confidential client (gets a client secret)** only if the client asks for a secret. Without the secret, it then gets no tokens.
5. Choose **Register**, then copy the **Client ID** and the **Client secret**.

Both show only once. A redirect URI must use `https`, or point to this machine. When you revoke a client, all its sign-ins stop and cannot renew.

## Take access away from an OAuth client

Under **OAuth grants**, each row is the consent of one user for one client. It shows the endpoints and the access that the user picked.

Choose **Revoke** to end that access. The client must sign in again, and the user gives consent again. Do this also to change **Read only** to **Read & write**.

Some actions on the Users page also end grants. A new password, a disabled user and a deleted user end all grants of that user.

## When a token does not work

- The client is asked to sign in: the token is wrong, expired or revoked.
- The client is told that the token is not for this endpoint: add the endpoint to a new token.
- The client is told that the endpoint does not take its kind of credential: the endpoint does not accept **Bearer tokens** in its Settings tab.
- The client is told that its credential has read-only access: the token or the grant is **Read only**.
- The client is refused on an endpoint: check that the role of the owner still has that endpoint, and that the owner is enabled.
- **Last used** does not change at each call: it moves at most once a minute.
