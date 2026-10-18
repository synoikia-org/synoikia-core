@id:notifications
Feature: Notifications
  The admin adds notification channels: a phone push channel or a webhook.
  A channel tells the admin about events of core, such as a failed sync, a crash or a locked sign-in.
  A notification informs. It never carries an approval, and nobody approves a call from it.

  Rule: The secrets of a channel are hidden

    Scenario: A phone channel shows only that its token is set, until the admin clears it
      Given the admin has a phone channel with a token
      When the admin renames the phone channel without its token, and then clears its token
      Then the admin saw the token as set after the rename, and as not set after the clear
      And the channels never showed the token

    Scenario: A change of kind, a bad topic and an unknown kind are refused
      Given the admin has a phone channel with a token
      When the admin tries to make the phone channel a webhook, then a channel with the topic "bad topic!", then a "pager" channel
      Then the admin is told that a channel keeps its kind, and that the other two channels are not valid

    Scenario: The admin adds, tests, turns off and deletes a webhook
      When the admin adds a webhook, tests it, turns it off and deletes it
      Then the test reached the webhook, the webhook showed as off, and the admin has no channel left

  Rule: A channel whose secrets the master key cannot read asks for them again

    Scenario: After a restart with another master key, the admin enters the token of the phone channel again
      Given the admin has a phone channel with a token
      And the operator restarts the server with another master key
      When the admin tests the phone channel, renames it, and then saves it with a new token
      Then the admin was told twice to enter the secrets again, and then the phone channel has its token set

    Scenario: The channel list still shows a channel whose secrets cannot be read
      Given the admin has a phone channel with a token
      And the operator restarts the server with another master key
      When the admin lists the channels
      Then the admin sees the phone channel, marked as having secrets that cannot be read

  Rule: Delivery is signed, filtered and tried again

    Scenario: A failed sync reaches a signed webhook on the third try, and skips the channel of another instance
      Given Acme Tasks runs as the instance "tasks"
      And the admin has a signed webhook for failed syncs that fails twice, and a webhook only for "shopping"
      When the admin syncs "tasks" while its plugin cannot list its operations
      Then the signed webhook got "Catalog sync failed for /tasks" on the third try, with the extra header
      And the webhook of "shopping" got nothing

    Scenario: A webhook that answers "not found" is asked once, and the channel keeps the error
      Given the admin has a webhook that answers "not found"
      When the admin tests the webhook
      Then the admin is told that the webhook answered "not found", it was asked once, and the channel keeps that error

    Scenario: A webhook that answers "too many requests" is tried again
      Given Acme Tasks runs as the instance "tasks"
      And the admin has a webhook for failed syncs that answers "too many requests" once
      When the admin syncs "tasks" while its plugin cannot list its operations
      Then the webhook got "Catalog sync failed for /tasks" on the second try

  Rule: Notifications inform and never approve

    Scenario: The phone hears about new writes to review, with no actions
      Given Acme Tasks runs as the instance "tasks"
      And the admin has a phone channel for writes to review
      When the plugin of "tasks" now calls "count the tasks" a write, and the admin syncs "tasks"
      Then the phone gets "1 write operation(s) to review on /tasks" with no actions

    Scenario: A channel cannot listen for approvals
      When the admin tries to add a phone channel for pending approvals
      Then the admin is told that the channel is not valid

  Rule: The channels hear when an instance goes down and when it recovers

    Scenario: The channels hear when an instance whose first sync failed recovers
      Given the admin gets a notification when an instance goes down, crashes or recovers
      And the plugin of "tasks" cannot list its operations
      And the admin added the instance "tasks" without a sync
      When the admin syncs "tasks", which fails, and then again after the plugin lists its operations
      Then the admin got the notifications "/tasks is down" and "/tasks recovered"

    @long-running
    Scenario: The channels hear when the plugin of an instance crashes and when it is back
      Given Acme Tasks runs as the instance "tasks"
      And the admin gets a notification when an instance goes down, crashes or recovers
      When the plugin of "tasks" crashes and starts again
      Then the admin got the notifications "/tasks is down", "Plugin for /tasks crashed" and "/tasks recovered"
