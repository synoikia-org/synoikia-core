@id:catalog-access-on-sync
Feature: Catalog access on sync
  A sync brings the operations of an instance up to date with its plugin.
  A sync never gives an agent more access than the admin gave.
  A new or changed write stays closed or asks, until the admin opens it.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: A sync never opens an operation by itself

    Scenario: A new write in a group at level write arrives switched off
      Given the group "lists" of "tasks" is at level write
      When the plugin of "tasks" adds the write "clear a list" to the group "lists", and the admin syncs "tasks"
      Then the admin sees that "clear a list" has its own level none, and is not acknowledged

    Scenario: A new read runs at its own level read
      When the plugin of "tasks" adds the read "show the done tasks" to the group "lists", and the admin syncs "tasks"
      Then the admin sees that "show the done tasks" has its own level read

    Scenario: A new operation in a group at level none follows the group
      Given the group "lists" of "tasks" is at level none
      When the plugin of "tasks" adds the write "clear a list" to the group "lists", and the admin syncs "tasks"
      Then the admin sees that "clear a list" follows its group at level none

  Rule: A changed operation never gains access

    Scenario: A read that becomes a write loses its own level read
      Given the admin gives "show the open tasks" its own level read
      When the plugin of "tasks" makes "show the open tasks" a write, and the admin syncs "tasks"
      Then the admin sees that "show the open tasks" has its own level none, and is not acknowledged

    Scenario: An acknowledged write whose parameters change asks again
      Given the group "tasks" of "tasks" is at level write
      When the plugin of "tasks" changes the parameters of "add a task", and the admin syncs "tasks"
      Then the group "tasks" shows 1 operation to acknowledge

    Scenario: A sync with no change keeps the acknowledgement
      Given the group "tasks" of "tasks" is at level write
      When the admin syncs "tasks"
      Then the admin sees that "add a task" is acknowledged

  Rule: An operation that becomes locked loses its own level and rules

    Scenario: A write that becomes locked loses its own level and its rules
      Given the admin gives "add a task" its own level write
      And the admin pre-approves adding any task to "Groceries"
      When the plugin of "tasks" locks "add a task", and the admin syncs "tasks"
      Then the admin sees that "add a task" is locked and off, with no own level
      And the admin sees that the rule on "add a task" is off, and the audit log says that the lock turned it off

    Scenario: A read that becomes locked is a write that is off
      When the plugin of "tasks" locks "count the tasks", and the admin syncs "tasks"
      Then the admin sees that "count the tasks" is a locked write, and is off

  Rule: A moved operation keeps its access

    Scenario: An operation moved out of a group at level none stays at none
      Given the group "lists" of "tasks" is at level none
      When the plugin of "tasks" moves "count the tasks" to the new group "reports", and the admin syncs "tasks"
      Then the admin sees that "count the tasks" has its own level none, in the group "reports" at level ask

    Scenario: A locked operation that is unlocked and moved in one sync stays closed
      Given the group "lists" of "tasks" is at level write
      And the group "tasks" of "tasks" is at level none
      When the plugin of "tasks" unlocks "delete a list" and moves it to the group "tasks", and the admin syncs "tasks"
      Then the admin sees that "delete a list" is at level none

    Scenario: An acknowledged write moved into a group at level write still asks
      Given the admin acknowledges "rename a list"
      And the group "tasks" of "tasks" is at level write
      When the plugin of "tasks" moves "rename a list" to the group "tasks", and the admin syncs "tasks"
      Then the admin sees that "rename a list" has its own level ask

  Rule: Vanished operations go stale, and return without more access

    Scenario: An operation that vanishes is stale, and agents cannot call it
      Given the plugin of "tasks" drops "count the tasks", and the admin syncs "tasks"
      When agent 7 counts the open tasks of "Groceries"
      Then the admin sees "count the tasks" as stale, and agent 7 is told that it is not in the catalog

    Scenario: A group whose operations vanish is stale, and keeps its level when they return
      Given the group "tasks" of "tasks" is at level none
      And the plugin of "tasks" drops "add a task", "complete a task" and "import tasks", and the admin syncs "tasks"
      When the plugin of "tasks" brings them back, and the admin syncs "tasks"
      Then the admin saw the group "tasks" as stale, and now sees it at level none again

    Scenario: A write that returns after it vanished asks again
      Given the group "tasks" of "tasks" is at level write
      And the plugin of "tasks" drops "add a task", and the admin syncs "tasks"
      When the plugin of "tasks" brings "add a task" back, and the admin syncs "tasks"
      Then the group "tasks" shows 1 operation to acknowledge

  Rule: Bulk levels, merges and result secrets stay correct across syncs

    Scenario: Setting every group to write acknowledges each write that is not locked
      When the admin sets every group of "tasks" to write
      Then the admin sees the 4 writes that are not locked as acknowledged, and "delete a list" and "archive a list" as off

    Scenario: A merge takes the lower level, and a sync keeps the merge
      Given the group "lists" of "tasks" is at level read
      When the admin merges the group "lists" into "tasks", and syncs "tasks"
      Then the admin sees only the group "tasks", at level read, with "show the open tasks" in it

    Scenario: A sync updates the result secrets of an operation
      Given the plugin of "tasks" declares the whole result of the open tasks secret
      And the plugin of "tasks" no longer declares it, and the admin syncs "tasks"
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs"
