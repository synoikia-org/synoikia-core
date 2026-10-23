@id:config-write
Feature: Config writes
  A config write changes the settings of an upstream object, such as the name of a list.
  The plugin reads the object first, and the approver sees each change as before and after.
  The call runs only if the object did not change since the plugin read it.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write
    And Acme also has the list "Chores" with the open task "dishes"

  Rule: The approver sees a config change as before and after

    Scenario: The approver sees the old and the new name
      When agent 7 renames "Chores" to "Housework"
      Then the approval page shows the name "Chores" before and "Housework" after

    Scenario: The approver never sees a share password
      Given the list "Chores" has the share password "chores-pass-1"
      When agent 7 renames "Chores" to "Housework" with the share password "chores-pass-2"
      Then the approval page shows the share password as [REDACTED] before and after
      And the approval page shows neither "chores-pass-1" nor "chores-pass-2"

    Scenario: A list that changed in Acme after the plugin read it is not renamed
      Given agent 7 waits for the admin to approve renaming "Chores" to "Housework"
      And someone adds "vacuum" to "Chores" in Acme
      When the admin approves the call and agent 7 resumes it
      Then agent 7 is told that the list changed in Acme
      And Acme still has the list "Chores"

  Rule: Rules and approvers see the list that the plugin will change
    The plugin reads the object before the gate decides.
    If the plugin then names another list, the gate decides on that list.

    Scenario: A pre-approved rename that the plugin moves to another list waits for a human
      Given the admin pre-approves renaming the list "Groceries"
      And the plugin of "tasks" turns each rename of "Groceries" into a rename of "Chores"
      When agent 7 renames "Groceries" to "Pantry"
      Then agent 7 is told that the call waits for a human to approve it
      And Acme still has the lists "Groceries" and "Chores"

    Scenario: The approver sees the list that the plugin will rename
      Given the plugin of "tasks" turns each rename of "Groceries" into a rename of "Chores"
      When agent 7 renames "Groceries" to "Pantry"
      Then the approval page names the list "Chores", and not "Groceries"
