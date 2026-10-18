@id:read-to-write-approval
Feature: A read that becomes a write during an approval
  A read with its own level ask waits for a human, like a write.
  A sync can call that read a write while the approval waits.
  Core accepts this risk. The approved call runs as the read that the agent asked for.
  It does not use the write budget.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: A read that a sync turns into a write during its approval runs as a read

    Scenario: A count that a sync turns into a write still runs as the approved read
      Given agent 7 waits for the admin to approve the count of "Groceries", which has its own level ask
      And the plugin of "tasks" now calls "count the tasks" a write, and the admin syncs "tasks"
      When the admin approves the call and agent 7 resumes it
      Then agent 7 is told that "Groceries" has 3 open tasks
      And the audit log records the approved count as a read, while the admin sees "count the tasks" as a write
