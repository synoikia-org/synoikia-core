---
title: Server settings
audience: admin
related: audit
---

Use this page to decide how long the audit log keeps its entries. Keep them long enough for the questions that you will ask later, such as who approved a call last month.

## Set how long the audit log keeps entries

1. Under **Audit log retention**, enter a number of days in **Delete entries older than (days)**.
2. Choose **Save**. The page says **Saved.** when the server accepts it.

The default is 90 days. The lowest value is 7 days. The server refuses a lower value and says why.

## Keep every entry

Clear the field and choose **Save**. The server then keeps every entry, and the audit log grows without a limit.

## What happens when entries are purged

The server removes old entries once an hour, and at each start. A lower retention therefore removes entries within the hour. You cannot get them back.

Each purge that removes entries writes its own entry in the audit log. It gives the number of entries that it removed. Filter by the decision `audit_purged` to find these entries.

Export the audit log before you lower the retention if you need the old entries. Use **Export CSV** on the **Audit Log** page.

## Who changed the retention

Each save shows in the audit log as a configuration change, with the old and the new value. Filter by the decision `settings_updated` to find it.
