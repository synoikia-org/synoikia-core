---
title: Notifications
audience: admin
related: server-settings, overview
---

A channel tells you when something on the server needs a look. Examples are an endpoint that went down, a failed sync or a sign-in lockout. Use this page to add a phone push channel with ntfy, or a webhook.

A notification only informs. It carries a short summary, never the parameters of a call or a secret. You cannot approve a call from it. Approvals happen on the approval page that your MCP client opens.

## Set up an ntfy topic

1. Choose **Add channel**, and keep **ntfy** as the **Type**.
2. Give the channel a **Name**, such as the device that gets it.
3. Keep the **Server**, or enter the address of your own ntfy server.
4. Enter a **Topic**. Use letters, digits, `-` and `_`, up to 64 characters.
5. If your ntfy server needs a sign-in, enter its **Access token**.
6. Pick the **Events**, then choose **Save**.
7. Subscribe to the same topic in the ntfy app on your phone.

On a public ntfy server, anyone who knows the topic can read it. Pick a topic that nobody can guess.

## Set up a webhook

1. Choose **Add channel**, and pick **Webhook** as the **Type**.
2. Enter a **Name** and the **URL** that gets the notifications.
3. Enter a **Signing secret** so that the receiver can check that the server sent the message.
4. Pick the **Events**, then choose **Save**.

The server posts JSON with the fields `event`, `at`, `instance`, `title`, `message` and `data`. The header `x-synoikia-event` gives the event, and `x-synoikia-timestamp` the time in seconds.

## Check a webhook signature

With a signing secret, each message has the header `x-synoikia-signature`. Its value is `sha256=` and a hex HMAC with SHA-256.

1. Join the value of `x-synoikia-timestamp`, a dot and the raw body.
2. Compute the HMAC of that text with your secret.
3. Compare it with the header value. Refuse the message if they differ.

## Check that a channel works

Choose **Test** on the channel. The test goes to the channel even when it is off or listens to other events. The alert **Test sent to** the channel means that the receiver accepted the message. A failed test gives the reason.

A webhook gets the test as the event `sync.failed`, with `test` set to true in `data`. Let your receiver accept it.

**Last sent** shows the time of the last message that arrived.

## Pick the events and the endpoints

- **Endpoint went down** and **Endpoint recovered**: an endpoint goes into error, and later runs again. An idle endpoint sends nothing.
- **Plugin crashed**: the plugin of an endpoint exited or stopped answering. The server starts it again.
- **Catalog sync failed**: the endpoint could not read its operations.
- **New write operations found**: a sync found new or changed writes. They ask for approval until you acknowledge them on the **Access** page. It also tells you when a sync disabled pre-approval rules that no longer fit.
- **Sign-in lockout**: too many failed sign-ins for one account.

Under **Endpoints**, clear **All endpoints** to pick some. A channel with picked endpoints never gets **Sign-in lockout**, because a lockout belongs to no endpoint.

To pause a channel, clear **Enabled** and save. The row shows faded.

## When a notification does not arrive

1. Choose **Test** and read the alert.
2. Read the red error under the channel name. It shows the last failure, until a message arrives again.
3. Check that the channel is enabled, and that it listens to the event and the endpoint.
4. For ntfy, check that your phone subscribes to the same server and topic.

The server tries each message up to three times. It does not try again after an answer such as "not found", because a new try would fail too. It waits at most 10 seconds for each try.

## Change or remove a channel

Choose **Edit**. The type of a channel cannot change. Leave a secret field empty to keep the stored secret. Select **Remove token** or **Remove secret** to clear it. Choose **Delete** to remove the channel.

After a restart with another master key, the server cannot read the stored secrets. A test then asks you to enter them again. For ntfy, enter the token again in **Edit**. For a webhook, delete the channel and add it again.
