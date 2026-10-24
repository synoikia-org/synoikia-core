---
title: Users
audience: admin
related: roles, user-auth
---

Use this page to add people, give each one a role, and take access away when needed. Each account has one role. The role decides which endpoints the person and their clients reach.

The **Sign-in** column shows how a person signs in. A local account has **password**, and **2FA** for an authenticator app. An SSO account has **SSO**, and **not signed in yet** until its first sign-in.

The **primary owner** is the first account of the server. It keeps the password sign-in when password sign-in is off, so the server always has a way in.

Nobody can delete or disable the primary owner, or change its role. Only the start-up settings set its password or reset its two-factor sign-in. So its row has no actions. An older release could disable the owner or move it out of the Admin role. Then its row offers **Enable** and the role, so that you can repair it.

## Add a user

1. Choose **Add user**.
2. Enter a **Username**. Spaces are not allowed, and names do not depend on case.
3. Under **Sign-in**, pick **Local account** or **SSO account**.
4. For a local account, enter a **Password** of at least 12 characters. For an SSO account, enter the person's address at the identity provider.
5. Pick the **Role**. The dialog starts at Admin, so change it for everyone who must not administer the server.
6. Choose **Add**.

Give the person their username and password, or tell them to sign in with single sign-on. The first sign-in with the verified address takes an SSO account. An account never changes kind: for the other kind, add a new account.

## Add a user for Cloudflare Access

Use the e-mail address of the person as the **Username**. Cloudflare Access names the user by that address, in any case.

An account without a password suits this. Only users that you add, or that Cloudflare Access made, can match. A person who made their own account on the sign-in page never matches.

## Give a family member access to one endpoint

1. On the Roles page, add a role, such as "family".
2. Select the endpoint for that role.
3. Choose **levels…** and set the most that the role can do in each group. Everything starts at **None**.
4. On this page, add the person with that role.
5. The person copies the endpoint URL from My endpoints into their client. For a bearer token, they make one on My profile.

The person reaches only that endpoint. Their clients never go above the levels that you set for the role.

## Change the role of a user

Pick the new role in the **Role** column. The change applies to the next call of each client of that user. A client loses the endpoints that the new role does not have.

The primary owner always keeps the Admin role. On a server without an owner, the last enabled admin cannot leave the Admin role. Give a second user the Admin role first.

## Set a password

Choose **Set password** to give a new password of at least 12 characters. Use it when a person forgot their password. An SSO account has no password, so its row has no **Set password**.

The person is signed out everywhere, also on the approval page. Each OAuth client that they connected loses access and must sign in again. Their bearer tokens keep working.

## Reset two-factor sign-in

Choose **Reset 2FA** when a person lost their authenticator app and their recovery codes. They then sign in with the password alone, and must enroll again. Their approval browsers must sign in again.

If User auth requires two-factor sign-in, they set up a new app at their next sign-in.

## Disable a user

Choose **Disable** to stop a person at once. Their sessions end now. Their bearer tokens, their OAuth grants and their session approvals end too.

**Enable** lets the person sign in again, but brings none of that back. They make new tokens and connect their clients again.

You cannot disable your own account.

## Delete a user

Choose **Delete** and type the username to confirm. The delete is permanent.

- Their sessions, tokens and OAuth grants end.
- Their personal levels and pre-approval rules go.
- Their pending approvals are cancelled.
- The audit log keeps their name.

A new user with the same name gets nothing of the old one. An automatic single sign-on or Cloudflare Access user comes back as a new user while a default role is set. To keep such a person out, disable them instead.

## When a user cannot sign in

- The sign-in says "try again in 15 min": five wrong passwords or codes locked the name. Wait 15 minutes.
- The user lost the authenticator app: choose **Reset 2FA**.
- The primary owner lost the password: set `ADMIN_BOOTSTRAP_USERNAME` and `ADMIN_BOOTSTRAP_PASSWORD`, and restart the server. If the owner also lost the app, add `ADMIN_BOOTSTRAP_RESET_2FA=true`.
- The user is disabled: choose **Enable**.
- The user has **SSO** and single sign-on fails: check the policy on User auth.
- The account shows **not signed in yet**: the identity provider must verify the address that you entered.
- Adding a user says "That username is taken": another account has that name, in another case.
