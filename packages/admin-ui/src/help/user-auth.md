---
title: User auth
audience: admin
related: users, roles
---

How people sign in to the portal and to the approval page.

## Sign-in

Local sign-in uses a username and a password. You can turn it off when single sign-on works and at least one user is linked.

## Approval page sign-in

A sign-in on the approval page lasts for the time you set. Locked operations still need a typed confirmation on each call.

## Self-registration

When it is on, a person can make an account on the sign-in page. The new account gets the default role. An admin decides what that role can reach.

## Default role for new accounts

Some accounts are made without an admin. These are unknown users that the MCP proxy names with External sign-in, and new single sign-on users when automatic users are on. With a default role set, they get an account with that role. Without one, Synoikia makes no account.

## Single sign-on (OIDC)

Users sign in with your identity provider. Without automatic users, each user links single sign-on on My profile first. With automatic users on, the first sign-in makes the account, with the default role.

## Let only one OIDC group sign in

Set **Required group** to let only the members of one group sign in. **Groups claim** names the claim that holds the groups, `groups` by default. Synoikia sets no role from a group. An automatic user gets the default role.
