---
title: My profile
audience: everyone
related: my-endpoints, my-endpoint
---

Use this page to give your MCP clients a token, to protect your sign-in, and to control the browsers that approve your calls.

Everything here is yours alone. A token or a connection that you make acts for you, within your role.

## Make a token for an MCP client

1. Under **My tokens**, choose **New token**.
2. Enter a **Name** that says which client or device uses it.
3. Keep **All my endpoints**, or clear it and pick the endpoints.
4. Pick the **Access**: **Read only** or **Read & write**.
5. If the client needs the token only for a time, set **Expires (optional)**.
6. Choose **Create token**, and copy the token at once. It is not shown again.

With **All my endpoints**, the token follows your role. It reaches an endpoint that your role gets later, and loses one that your role loses.

A **Read only** token cannot run writes, even where your level allows them.

**New token** is off while your role has no endpoints. Only you can approve the calls of your token. To connect a client with it, see the help of **My endpoints**.

## Revoke a token or a connection

Choose **Revoke** next to the token. Clients that use it lose access at once and must sign in again.

**My OAuth connections** lists the clients that you let in through a browser sign-in. Revoke one the same way.

Revoke a token when a device is lost, or when you no longer use the client. Each row shows when the token was last used.

## Set up two-factor authentication

1. Choose **Set up two-factor authentication**.
2. Add the secret to your authenticator app, or choose **Open in authenticator app** on a phone.
3. Enter the 6-digit code that the app shows, then choose **Confirm**.
4. Save the recovery codes in a safe place, then choose **I saved them**.

From then on, a password sign-in asks for a code from the app.

## When you lose your authenticator app

Each recovery code signs you in once in place of a code from the app. The page shows how many codes you have left.

To get new codes, choose **New recovery codes** and enter a current code from the app. A recovery code does not work there. The old codes then stop working.

Without the app and without codes, ask an administrator to reset your two-factor authentication. You then set it up again.

To turn two-factor off, enter a current code or a recovery code and choose **Turn off**.

## Trust a browser for approvals

When you sign in on the approval page, that browser becomes an approval browser. It approves your next calls without a new sign-in.

The sign-in ends after a time without use, and after a longest time. By default these are 12 hours and 7 days.

Choose **Sign out all approval browsers** when you lose a device, or use a shared computer. Your next approval then asks you to sign in again. You stay signed in to the portal.

## Change your password

Enter your **Current password**, then the **New password** twice. A new password needs at least 12 characters. A change signs out your other sessions.

## Link single sign-on

This section shows when the server offers single sign-on. Choose **Link** to sign in with that account too. To unlink it, you need a password on your account first.

## Users who lose their second factor {admin}

On the **Users** page, choose **Reset 2FA** for the user. The user must set up two-factor authentication again.

The idle time and the longest time of approval browsers are settings under **User auth**.
