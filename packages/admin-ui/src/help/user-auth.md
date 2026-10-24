---
title: User auth
audience: admin
related: users, roles
---

Use this page to decide how people sign in to the portal, to the OAuth consent page and to the approval page. It also decides who gets an account without you.

Each card saves on its own. A change on one card does not save the others.

## Require two-factor sign-in

Select **Require two-factor authentication for password sign-in** and save. At their next password sign-in, each user without an authenticator app must set one up before anything else.

While it is on, nobody can turn off their own app. A user without an app cannot give consent to an OAuth client. The consent page tells them to set up the app in the portal first.

## Set how long sign-ins last

- **Session idle timeout (minutes)**: a portal session ends after this time without use. The default is 30.
- **Max session authentication duration (hours)**: a portal session ends after this time, however active it is. The default is 12.
- **Approval page sign-in idle timeout (hours)**: an approval browser signs out after this time without use. The default is 12, and the maximum is 168.
- **Approval page sign-in maximum (days)**: an approval browser signs out after this time in total. The default is 7, and the maximum is 30.

A longer approval sign-in means fewer sign-ins for people who approve calls. A shorter one limits what a lost or shared browser can approve.

## Turn on single sign-on

1. In your identity provider, make an OIDC client. Register the **Redirect URI** that the card shows.
2. Under **Single sign-on (OIDC)**, select **Enabled**.
3. Enter the **Issuer URL**, the **Client ID** and the **Client secret**.
4. Keep the **Scopes** `openid email profile`, unless your provider needs more.
5. Optionally, change the **Button label** that the sign-in page shows.
6. Choose **Save single sign-on**.
7. Ask each user to sign in with their password and link single sign-on on My profile.

Without an issuer and a client ID, single sign-on does not turn on. An identity that no user linked cannot sign in, unless automatic accounts are on.

## Choose who may sign in with single sign-on

Under **Who may sign in**, an identity may sign in when it matches one entry. **Allowed emails**, **Required group** and **Allowed subjects** each let identities in.

- **Allowed emails** takes exact addresses, or `*@example.com` for a whole domain. A domain entry does not match its subdomains.
- An address counts only when the provider says that it is verified.
- **Allowed subjects** takes the `sub` values of the provider.

With all three empty, every identity that a user linked may sign in. The policy also applies to users who linked before you set it.

## Let only one OIDC group sign in

1. Enter the group in **Required group**.
2. Leave **Allowed emails** and **Allowed subjects** empty. An entry there lets people in who are not in the group.
3. In **Groups claim**, enter the claim that holds the groups. The default is `groups`.
4. Make sure that your provider sends that claim in the ID token, as a list.
5. Choose **Save single sign-on**.

The group only decides who may sign in. Synoikia sets no role from an OIDC group. An automatic new user gets the default role of new accounts. Change the role of a user on the Users page.

## Make accounts on first sign-in

Select **Provision an account on first sign-in for anyone the policy allows**. This needs an entry under **Who may sign in**, and a **Default role of new accounts**. Without a default role, Synoikia makes no account.

The new username comes from the username or the e-mail address at the provider. If that name is taken, also in other letter case, Synoikia adds a number, such as `-2`.

A deleted automatic user comes back as a new user at the next sign-in. To keep a person out, disable the user instead, or change the policy.

## Let people make their own account

**Default role of new accounts** turns self-registration on. With **None: nobody can register**, Synoikia makes no account by itself.

With a role set, Synoikia gives that role to each account that it makes by itself:

- an automatic single sign-on user, when automatic accounts are on
- an unknown Cloudflare Access user, when client auth uses **External**
- a person who uses **Create account** on the sign-in page

**Show “Create account” on the sign-in page** needs a default role. The form also stays closed while password sign-in is off.

If you pick Admin, you must type `ADMIN` to save. Each new account then administers the server. You cannot delete the role that is the default.

## Turn off password sign-in

Select **Disable password sign-in (single sign-on only)** and save. This needs single sign-on on, and at least one linked user.

Before you do this, sign in once with single sign-on yourself. While password sign-in is off, Synoikia refuses each change that leaves no linked user who can sign in. That includes turning single sign-on off, unlinking, and disabling or deleting the last linked user.

## If nobody can sign in

- A name is locked for 15 minutes after five wrong passwords or codes. Wait, then try again.
- If single sign-on fails while password sign-in is off, restart the server with `ADMIN_FORCE_LOCAL_LOGIN=true`. Password sign-in then works again.
- A linked user without a password cannot unlink. Set a password for them on the Users page first.
- A refused single sign-on is in the audit log. Check the policy under **Who may sign in**.
- The portal answers only to `localhost`, IP addresses, the host of `PUBLIC_ADMIN_URL` and the names in `ADMIN_ALLOWED_HOSTS`. Another host name is refused, so add it there.
