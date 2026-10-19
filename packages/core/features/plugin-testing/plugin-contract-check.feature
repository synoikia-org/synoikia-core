@id:plugin-contract-check
Feature: Plugin contract check
  Every plugin repeats the same checks against core: a read runs, a write is refused at level read, a locked operation needs its typed confirmation, and no secret reaches the sandbox.
  The contract check of the core testing package runs these checks in the plugin harness and lists each issue it finds.
  A plugin author fakes the upstream service with the fake server of the same package.

  Background:
    Given Acme has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "sweep"
    And the list "Groceries" has the share password "groceries-share-7"

  Rule: A plugin proves that it keeps the contract of core

    Scenario: Acme Tasks keeps the contract
      Given plugin author 3 started the plugin harness on Acme Tasks
      When plugin author 3 checks the contract with "show the open tasks", "add a task", "delete a list" of "Chores" and the share password
      Then the contract check reports no issues

    Scenario Outline: The contract check reports a build that <breaks>
      Given plugin author 3 started the plugin harness on a build of Acme Tasks that <breaks>
      When plugin author 3 checks the contract with "show the open tasks", "add a task", "delete a list" of "Chores" and the share password
      Then the contract check reports that <issue>

      Examples:
        | breaks                                              | issue                                                              |
        | swaps the reads and the writes                      | "show the open tasks" is not a read and "add a task" is not a write |
        | asks to type "delete" to delete a list              | "delete a list" asks to type "delete" in place of "Chores"         |
        | shows the share password under the name "code"     | the share password reached the sandbox                             |

    Scenario: The contract check reports an operation that the catalog does not have
      Given plugin author 3 started the plugin harness on Acme Tasks
      When plugin author 3 checks the contract with the read "show the done tasks" and the write "add a task"
      Then the contract check reports only that the catalog has no "show the done tasks"

  Rule: The fake server answers only the routes that the test declares

    Scenario: A declared route answers, and the fake server keeps the request
      Given plugin author 3 fakes Acme with a route for a list by its name, which needs the API token
      When plugin author 3 asks the fake Acme for the list "Our chores"
      Then the fake Acme answers with the list "Our chores", and kept one request for that list

    Scenario Outline: The fake Acme answers <request> with <answer>
      Given plugin author 3 fakes Acme with a route for a list by its name, which needs the API token
      When plugin author 3 asks the fake Acme for <request>
      Then the fake Acme answers <answer>

      Examples:
        | request                                       | answer                                    |
        | the done tasks of "Groceries"                 | that it has no such route                 |
        | the share password of "Groceries"             | with a server error that says "share is down" |
        | the list "Groceries" without the API token    | that the request is not authorized        |
