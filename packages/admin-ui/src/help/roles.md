---
title: Roles
audience: admin
related: access, users
---

Use this page to decide which endpoints a group of people reaches, and what they may change for themselves there. Each user has one role. Give the role to users on the Users page.

Admin is built in. It reaches every endpoint at the levels of the endpoint, and every setting. Nobody can change it. Each other role reaches only the endpoints that you select here.

## Make a role

1. Enter a name under **New role name** and choose **Add role**.
2. Select each endpoint that the role must reach.
3. Choose **levels…** next to each endpoint, and set the most that the role can do there.
4. Give the role to users on the Users page.

Each role needs its own name. Changes on this page apply at once, without a save.

## Set what a role can do on an endpoint

Choose **levels…** to open the Access tab of the endpoint, with **Levels for** set to the role. Set the most that the role can do in each group, or for one operation.

A role never goes above the level of the endpoint. With the endpoint at **Ask**, a role at **Write** still asks. A new endpoint in the role and a new group after a sync start at **None**. The role reaches nothing there until you set levels.

## Take an endpoint away from a role

Clear the endpoint and confirm. The role loses its levels there. Its users lose their personal levels and their own rules on that endpoint.

Their clients are refused on that endpoint at the next call. If you add the endpoint again, everything starts at **None**, with every switch off.

## Let users set personal levels

Turn on **Set personal levels** on an endpoint. Each user can then lower the level of a group or an operation for their own calls. For example, a user can make writes ask, or turn a group off.

A personal level never goes above the most that the role allows. If you turn the switch off, the personal levels stop counting, but stay stored. They count again when you turn it back on.

## Let a role keep its own rules

1. Turn on **Own pre-approval rules** on the endpoint.
2. Choose **levels…** and set the groups or operations that the rules cover to **Ask**.
3. Tell your users to add rules on that endpoint from My endpoints.

A user can write rules only for operations that they can call. Their rules apply only to their own calls. You see who owns each rule.

Pre-approval rules cover calls that ask. At **Write**, calls run without a question, so a rule has nothing to do. A call there asks only when a personal level makes it ask. At **Read** or **None**, the writes are off.

## Let users see the endpoint status

Turn on **See endpoint status** on an endpoint. Its users then see the health, plugin and sync state of the endpoint. They also see each operation, also the ones that they cannot call, with the reason.

Without it, users see only the operations that they can call.

## Let users see other endpoints

Turn on **See other endpoints** to show the other endpoints by name and description. This gives no access. Use it so that people know what to ask an admin for.

## Rename or delete a role

**Rename** keeps the users and the settings of the role. **Delete** asks first.

You cannot delete a role while a user has it. Move those users to another role first. You also cannot delete the role that is the default for new accounts. Change the default on User auth first.

## When a user cannot reach an endpoint

- The client is told that the endpoint is not available to the role: select the endpoint for the role.
- The client is told that the operation is off: set a level above **None** for the role with **levels…**.
- A write asks although the role is at **Write**: the endpoint or the personal level of the user is at **Ask**.
- A user cannot add a rule: turn on **Own pre-approval rules**, and give the role **Ask** for that operation.
