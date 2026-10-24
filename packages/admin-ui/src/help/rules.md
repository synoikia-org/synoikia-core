---
title: Pre-Approval Rules
audience: everyone
related: access, endpoint-settings
---

A rule lets some calls of an operation at **Ask** run without asking a person. Use it for safe writes that clients repeat, such as adds to one list.

A rule names one operation and the parameter values that it accepts. A call that the rule does not match asks a person, as before.

## Make a rule

1. Choose **New rule**.
2. Pick the operation. Type a part of its key in the filter box to find it.
3. Under **Only when**, set the values that a call may send.
4. Set a **Rate limit** or an **Expires** time if you want one.
5. Write the **Reason**.
6. Choose **Save rule**.

The rule applies from the next call. Make a test call from your client. The audit log names the rule on each call that it approves.

A rule that an admin makes applies to the calls of every user, while their level for the operation is **Ask**. A role can also let its users make their own rules. An own rule approves only the calls of its owner's clients. When the role stops own rules, only admin rules apply.

## When a call still asks

Look at the rule in the list first. A note under it says when it skipped a call because of a parameter that it does not accept. The **inert** label says why the rule cannot approve anything now.

- The call sends a parameter that the rule does not cover. Set that parameter to **any value** if any value is safe.
- A value of the call is outside what the rule accepts.
- The rule reached its **Rate limit** for the window.
- The rule expired, or it is disabled.
- The rule belongs to a user, and the call comes from a client of another person.

A session approval of the client approves the call before any rule. The audit log then names the session approval, not the rule.

## What a rule never does

- A rule never applies to a locked operation. A locked operation always asks a person.
- A rule does nothing for a call at **None** or **Write**.
- A rule never skips a typed confirmation.
- A rule never lets a read-only client write.
- A rule never lifts the **Writes per minute** limit of the endpoint. A write over that limit is refused.

## Operation

The write that the rule pre-approves. The list shows only writes that are not locked. An operation that is off shows the reason next to its key.

A rule applies only while the operation is at **Ask**. At **Write** the operation already runs without asking. At **None** it is off.

You cannot change the operation of a saved rule. Make a new rule instead.

## Only when

The fields come from the plugin. The rule applies only to calls whose parameters match all the fields. The small text after a field name says how it compares.

- `eq`: the value must be the same.
- `prefix`: the value, or a path below it. `media` matches `media/tv`, but not `media-old`.
- `in`: each value of the call must be in your list.
- `range`: a number from the minimum to the maximum.
- `bool`: only the value that you pick, true or false.

A field that picks targets, such as devices or lists, matches only when every target of the call is in your selection. A value with a `..` part never matches a prefix.

## How matching works

Matching is strict. A call matches only if the rule covers each parameter that the call sends.

- An empty field means that the call must not send that parameter.
- **any value** accepts the parameter with any value, or when the call leaves it out.
- An empty list or an empty object in the call is a parameter too.
- A rule with no conditions matches only calls without parameters.
- When more than one rule matches, the oldest rule with budget left approves the call.

## Other parameters

Parameters that the form does not list, which a call can still send with any value. Write them as paths, such as `/quota`. A path also covers everything below it.

## Any other parameters

**Accept any other parameters** matches calls whatever other parameters they send. The rule then covers far more calls than the fields suggest. Use it only when no parameter can make the call unsafe.

## Rate limit

How many calls the rule approves in the window. A call over the limit is not refused. It asks a person instead, and the audit log says that the rule was at its limit. Leave the limit empty for no limit.

Set the window in **Per (minutes)**. The default is 60.

## Expires

After this time, in your local time, the rule stops and calls ask again. The rule stays in the list. Leave it empty to keep the rule.

## Reason

Why the call is safe to run without asking. The reason is required, with at least 3 characters. The audit log records the reason with each call that the rule approves. A reader of the log then sees why no person was asked.

## Enabled

A disabled rule stays, but it approves nothing. Matching calls then ask a person. **Disable** and **Enable** in the list do the same. **Delete** removes the rule after a question.
