---
title: User auth
audience: admin
related: users, roles
---

How people sign in to the portal and to the approval page.

## Sign-in

Local sign-in uses a username and a password. You can turn it off when single sign-on works and at least one user is linked.

## Self-registration

When it is on, a person can make an account on the sign-in page. The new account gets the default role. An admin decides what that role can reach.

## Single sign-on (OIDC)

Users sign in with your identity provider. A user links an account on My profile, or the first sign-in makes one when automatic users are on.

## Let only one OIDC group sign in

Set **Required group** to let only the members of one group sign in. **Groups claim** names the claim that holds the groups, `groups` by default. Synoikia sets no role from a group. An automatic user gets the default role.
