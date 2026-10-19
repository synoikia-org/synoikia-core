@id:plugin-test-harness
Feature: Plugin test harness
  A plugin author tests a plugin against the real core with the plugin harness of the core testing package.
  The harness runs one staged copy of the built plugin, with the gate, the approvals, the redaction and the audit log of core.
  The test code decides each approval in place of a human.

  Background:
    Given Acme has the list "Groceries" with the open tasks "milk", "bread" and "eggs"

  Rule: The harness runs one staged copy of the plugin

    Scenario: The harness runs only the plugin under test, with its catalog synced
      When plugin author 3 starts the plugin harness on Acme Tasks
      Then the harness runs only Acme Tasks, from its own copy, with its catalog synced
      And "delete a list" is locked in the harness, and an operation that Acme Tasks does not have is an error

    Scenario: The harness refuses a plugin that is not built
      Given plugin author 3 has a copy of Acme Tasks without its entry file
      When plugin author 3 starts the plugin harness on that copy
      Then the harness does not start, and tells plugin author 3 to build the plugin first

    Scenario: The harness stages the agent instructions and removes its copy when it stops
      Given plugin author 3 has a copy of Acme Tasks with the agent instructions "Name each list by its title."
      When plugin author 3 starts the plugin harness on that copy and then stops it
      Then the staged copy held the agent instructions "Name each list by its title.", and the copy is gone

  Rule: Calls in the harness follow the access levels of the moment

    Scenario: A read runs at level read, and the share password stays hidden
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "lists" at level read
      And the list "Groceries" has the share password "groceries-share-7"
      When the harness run asks for the share password of "Groceries"
      Then the harness run sees the share password as [REDACTED]

    Scenario: An add is refused at level read
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "tasks" at level read
      When the harness run adds "butter" to "Groceries"
      Then the harness run is told that the operation is off
      And Acme never receives "butter"

    Scenario: An add runs once the test raises its group to write
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "tasks" at level read
      And the test raises the group "tasks" to write
      When the harness run adds "butter" to "Groceries"
      Then the harness run gets the task "butter"

  Rule: The test code decides each approval

    Scenario Outline: The add of "butter" when the test <answer>
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "tasks" at level ask
      When the harness run adds "butter" to "Groceries", and the test <answer>
      Then <outcome>

      Examples:
        | answer                     | outcome                                        |
        | approves it                | the harness run gets the task "butter"         |
        | denies it                  | the harness run is told that the call was denied |
        | has no approval handler    | the harness run is told that the call was denied |

    Scenario: A parked add runs once the test approves it and the run resumes
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "tasks" at level ask
      And the harness run parked the add of "butter" to "Groceries" until a human approves it
      When the test approves the parked add, and the harness run resumes it
      Then the harness run gets the task "butter"
      And Acme receives the add of "butter"

    Scenario: A pre-approval rule approves the add without the test
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "tasks" at level ask
      And the test pre-approves adding any task to "Groceries"
      When the harness run adds "butter" to "Groceries" with no way to ask a human
      Then the harness run gets the task "butter", and the audit log of the harness shows that a rule approved it

  Rule: A locked operation runs in the harness only with its typed confirmation

    Scenario: The test types a wrong name, then the name of the list
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "lists" at level read
      And the test sets "delete a list" to ask in the harness
      When the harness run deletes the list "Groceries", and the test types "groceries" and then "Groceries"
      Then the test was told to type "Groceries" exactly
      And Acme no longer has the list "Groceries"

    Scenario: A test that keeps typing a wrong name gets the call denied
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "lists" at level read
      And the test sets "delete a list" to ask in the harness
      When the harness run deletes the list "Groceries", and the test types only "groceries"
      Then the harness run is told that the call was denied, and the harness kept the error of the test
      And Acme still has the list "Groceries"
