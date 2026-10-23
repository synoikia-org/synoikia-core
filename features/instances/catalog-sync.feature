@id:catalog-sync
Feature: Catalog sync
  Core reads the catalog of an instance from its plugin, and serves calls only from a catalog that the running plugin code sent.
  A catalog that breaks the plugin contract changes nothing.

  Rule: New plugin code syncs before it serves

    Scenario: New plugin code that adds an operation is synced before the next search
      Given agent 7 belongs to the admin and may read and write
      And Acme Tasks runs as the instance "tasks"
      And the plugin of "tasks" was updated to version 1.1.0 with the new read "show the done tasks"
      When agent 7 searches the catalog of "tasks"
      Then agent 7 finds the operation "show the done tasks"

    Scenario: A resync that fails refuses calls until a resync works
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the plugin of "tasks" was updated to version 1.1.0, and it cannot list its operations
      When agent 7 asks for the open tasks of "Groceries" before and after the plugin lists its operations again
      Then agent 7 is first told that "tasks" is unavailable, and then gets "milk", "bread" and "eggs"

    Scenario: A new version in the plugin record alone does not sync
      Given agent 7 belongs to the admin and may read and write
      And Acme Tasks runs as the instance "tasks"
      And the manifest of Acme Tasks says version 1.1.0, and the admin rescans the plugins folder
      When agent 7 searches the catalog of "tasks"
      Then Acme was asked for its catalog once

  Rule: A plugin that reports a change of its catalog is synced soon after

    @long-running
    Scenario: The plugin reports that its catalog changed, and core syncs it
      Given agent 7 belongs to the admin and may read and write
      And Acme Tasks runs as the instance "tasks"
      And Acme gets the saved view "Weekend"
      When the plugin of "tasks" reports that its catalog changed
      Then the admin sees the saved view "Weekend" in the catalog of "tasks" within 5 seconds

  Rule: Bad catalog output changes nothing

    Scenario: A catalog with the same operation twice is refused
      Given Acme Tasks runs as the instance "tasks"
      And the plugin of "tasks" sends the new read "show the done tasks", and "show the open tasks" twice
      When the admin syncs "tasks", which fails
      Then the admin sees the 9 operations of "tasks" as before, without "show the done tasks"

    Scenario: A catalog with an operation that has no classification is refused
      Given Acme Tasks runs as the instance "tasks"
      And the plugin of "tasks" sends the new read "show the done tasks", and "count the tasks" without its classification
      When the admin syncs "tasks", which fails
      Then the admin sees the 9 operations of "tasks" as before, without "show the done tasks"

    Scenario: A catalog with result secrets that name no field is refused
      Given Acme Tasks runs as the instance "tasks"
      And the plugin of "tasks" sends the new read "show the done tasks", and result secrets of "count the tasks" that name no field
      When the admin syncs "tasks", which fails
      Then the admin sees the 9 operations of "tasks" as before, without "show the done tasks"

  Rule: A large sync gives its memory back

    @exclusive
    Scenario: A sync of 3,000 operations leaves the memory of core about where it was
      Given Acme Tasks runs as the instance "tasks", and its plugin lists 3,000 operations
      When the admin syncs "tasks" twice
      Then core holds at most 15 MB more memory than before the first sync
