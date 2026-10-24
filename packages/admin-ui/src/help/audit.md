---
title: Audit Log
audience: admin
related: server-settings, rules
---

The audit log records each call, search, configuration change, sign-in and plugin event. Use it to find out who did what, who approved a call, and why a call was refused.

Nobody can change or delete an entry. Only the purge after the retention time removes entries.

## Find who approved a call

1. Set **Kind** to **Calls**, and pick the **Endpoint**.
2. Enter the start of the operation key in **Operation**.
3. Enter `human-approved` in **Decision starts with**.
4. Set **From** and **To** around the time of the call, then choose **Apply**.

The **Actor** column then shows **decided by** and the approver. **via url** means an approval on the approval page. **via elicitation** means an approval in the agent session. It names the client.

## What the decision of a call means

- `auto-executed`: a read that ran without a question.
- `auto-approved:level`: a write that ran because its level is **Write**.
- `auto-approved:rule:` and an id: a pre-approval rule approved it.
- `auto-approved:grant:` and an id: a session grant approved it.
- `human-approved`: a person approved it.
- `awaiting_approval`: the call waited for a person when it was recorded.
- `denied` and `timed-out`: a person refused it, or nobody decided in time.
- `rejected:` and a reason: the server refused the call, for example over a rate limit.

**Decision starts with** matches the start of the text. Enter `auto-approved` to find every call that ran without a person.

## Filter the log

- **Actor**: the exact user name or id, in any case. It also finds a deleted user by the old name. A user name does not find the calls of that user's clients.
- **Operation**: the start of the operation key.
- **Target contains**: a part of the targets that the call touched, such as an id.

The filters apply only when you choose **Apply**. The log shows 100 entries on each page. Use **Newer** and **Older** to move between pages.

## Read the details of an entry

Select a row to open it. It shows the parameters, the targets, the result, the duration and other details. Secrets show as `[REDACTED]`.

A configuration change shows the value before and after the change, without secrets.

## Who the actor is

- A user name: a person in the portal, such as an admin who changed a setting.
- An id: the MCP client that made a call or a search. The person who approved it shows under **decided by**.
- **(deleted)** after a name: the user no longer exists.
- `system`: the server itself, such as a catalog sync or a purge.

To find the calls of one client, copy the id from the **Actor** column into the **Actor** filter.

## Export the log

Set the filters, then choose **Export CSV**. The file has every entry that matches, newest first, not only the page on screen.

The export uses the filters as they are in the form, also before you choose **Apply**. Check them before you export.

## When an entry is missing

- Choose **Apply** after a change of the filters. The list does not change before that.
- Clear filters that you do not need. **Actor** needs the full name.
- Check the retention on **Server settings**. The server removes older entries each hour.
