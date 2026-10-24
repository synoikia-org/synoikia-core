---
title: Pre-Approval Rules
audience: everyone
related: access, endpoint-settings
---

A rule lets a matching write call run without asking a person. The audit log records the reason of the rule with each call that the rule approves.

## What a rule never does

- A rule never applies to a locked operation. A locked operation always asks a person.
- A rule on an operation that is not reachable does nothing.
- A rule never skips a typed confirmation.

## Operation

The write that the rule pre-approves. Rules apply while the operation is at **Ask**. At **Write** the operation already runs without asking. Locked operations cannot be pre-approved.

## Only when

The rule applies only to calls whose parameters all match what you set here.

## How matching works

Matching is strict. A call matches only if the rule covers each parameter that the call sends.

- An empty field means that the call must not send that parameter.
- **Any value** accepts the parameter with any value, or when the call leaves it out.

## Other parameters

Parameters that the form does not list, which a call can still send with any value. Write them as paths, such as `/quota`.

## Any other parameters

**Accept any other parameters** matches calls whatever other parameters they send. The rule then covers far more calls than the fields suggest. Use it only when no parameter can make the call unsafe.

## Rate limit

How many calls the rule approves in the window. A call over the limit is not refused. It asks a person instead. Leave the limit empty for no limit.

The window is in minutes. The default is 60.

## Expires

After this time, in your local time, the rule stops and calls ask again. Leave it empty to keep the rule.

## Reason

Why the call is safe to run without asking. The audit log records the reason with each call that the rule approves. A reader of the log then sees why no person was asked.

## Enabled

A disabled rule stays, but it approves nothing. Matching calls then ask a person.
