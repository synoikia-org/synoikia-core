@id:instance-supervision
Feature: Instance supervision
  Core keeps the plugin of each enabled instance running, unless the plugin may stop when idle and nobody calls it.
  When the plugin crashes or cannot start, core starts it again after a pause that grows with each failure.
  Core starts, stops and restarts a plugin one step at a time, and keeps secrets out of every error it shows.

  Rule: A crashed instance restarts

    Scenario: A plugin that crashes is started again, and the crash is reported
      Given core starts a failed plugin again after 100 milliseconds, and gives a start 1 second
      And Acme Tasks runs as the instance "tasks"
      And the admin gets a notification when a plugin crashes
      When the plugin of "tasks" crashes
      Then the admin got the notification "Plugin for /tasks crashed" because the plugin exited unexpectedly, and "tasks" is ready again

  Rule: A failing start is retried with back-off

    Scenario: A start that cannot reach Acme is tried again until the admin fixes the address
      Given core starts a failed plugin again after 100 milliseconds, and gives a start 1 second
      And Acme Tasks runs as the instance "tasks", and its plugin checks Acme when it starts
      And the admin moved "tasks" to the address "http://127.0.0.1:9", and its start failed twice
      When the admin moves "tasks" back to the address of Acme
      Then the admin sees that "tasks" is ready, after the errors "init failed: cannot reach upstream"

    Scenario: A start that hangs counts as a failure, and the admin can still stop the instance
      Given core starts a failed plugin again after 100 milliseconds, and gives a start 1 second
      And the plugin of "tasks" never finishes its start
      And the admin added the instance "tasks", and its start failed
      When the admin disables the instance "tasks"
      Then the admin sees that "tasks" is stopped, after the error "init failed: Plugin did not answer init within 1000 ms"

    @exclusive
    Scenario: A start that crashes counts as a failure
      Given core starts a failed plugin again after 100 milliseconds, and gives a start 1 second
      And the plugin of "tasks" crashes during its start
      When the admin adds the instance "tasks", and its start fails
      Then the admin sees "tasks" with an error that says the plugin exited during its start

  Rule: Start, stop and restart run one at a time

    Scenario: Four restarts at the same moment leave one process
      Given Acme Tasks runs as the instance "tasks"
      When the admin saves the connection of "tasks" four times at the same moment
      Then the admin sees that "tasks" is ready, with one process of Acme Tasks and no plugin error

    Scenario: A stop during a start that hangs ends at once
      Given the plugin of "tasks" never finishes its start
      And the admin started to add the instance "tasks"
      When the admin disables "tasks" while it starts
      Then "tasks" is stopped within 2 seconds, and no process of Acme Tasks runs

    Scenario: A stopped instance is not started again
      Given Acme Tasks runs as the instance "tasks"
      When the admin disables the instance "tasks"
      Then "tasks" stays stopped, and no process of Acme Tasks runs

  Rule: Secrets never appear in stored, audited or sent errors

    Scenario: A start error that quotes the API token shows it as [REDACTED]
      Given the admin gets a notification when a plugin crashes or a sync fails
      And the plugin of "tasks" checks Acme when it starts
      And Acme answers every request with an error that quotes the API token
      When the admin adds the instance "tasks", and its start fails
      Then the instance, the audit log and the notifications show [REDACTED] in place of the API token

    Scenario: A sync error that quotes the API token shows it as [REDACTED]
      Given Acme Tasks runs as the instance "tasks"
      And the admin gets a notification when a plugin crashes or a sync fails
      And Acme answers every request with an error that quotes the API token
      When the admin syncs "tasks", which fails
      Then the instance, the audit log and the notifications show [REDACTED] in place of the API token

  Rule: An instance that nobody calls stops until its next call

    Scenario: An instance that nobody calls goes idle
      Given Acme Tasks runs as "tasks", which may stop when idle, and the admin lets it stop after 10 minutes
      And 10 minutes go by without a call to "tasks"
      When the admin opens the instances
      Then the admin sees "tasks" as idle, and no notification was sent

    Scenario: A call to an idle instance starts it, then runs
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And "tasks" went idle
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs", and the admin sees "tasks" as ready

    Scenario: An instance with a waiting approval does not go idle
      Given Acme Tasks runs as "tasks", which may stop when idle
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And 10 minutes go by without another call to "tasks"
      When the admin approves the add
      Then "butter" is on "Groceries", and the admin saw "tasks" as ready the whole time

    Scenario: A call that cannot start an idle instance fails, and is not retried at once
      Given "tasks" went idle
      And Acme Tasks is down
      When agent 7 asks for the open tasks of "Groceries", and asks again at once
      Then agent 7 is told both times that "tasks" is unavailable, and the admin sees one failed start, with the next one after a pause

    Scenario: A guide read on an idle instance starts it
      Given "tasks" went idle
      When agent 7 reads the guide of "import tasks"
      Then agent 7 gets the guide "Import at most 100 tasks at once, one title for each line.", and the admin sees "tasks" as ready

    Scenario: A plugin that keeps a live connection never goes idle
      Given Acme Tasks runs as "tasks" with a plugin that does not say it may stop when idle
      When the admin tries to let "tasks" stop after 10 minutes
      Then the admin is told that this plugin must stay running, and "tasks" stays always on

    Scenario: An idle time below 5 minutes is refused
      Given Acme Tasks runs as "tasks", which may stop when idle
      When the admin tries to let "tasks" stop after 4 minutes
      Then the admin is told that an instance stops after 5 minutes at the least, and "tasks" still stops after 10 minutes
