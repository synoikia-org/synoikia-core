@id:plugin-conformance
Feature: Plugin conformance
  Plugin author 3 runs the conformance check of the SDK on the "Acme Tasks" plugin before a release.
  The check drives the plugin against the fake Acme Tasks as core does, and validates each answer as core does.
  It reports each break with the place where it happened.

  Background:
    Given Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme Tasks describes its API in an OpenAPI 3.0 description
    And plugin.yaml of the plugin keeps the result of "Create an API token" secret and locks "Delete a list" with a twin for other users
    And the conformance check resolves "Show the open tasks" and "Delete a list" of "Groceries", and expects "/nope" to be refused

  Rule: A conforming plugin passes, and an invalid manifest stops the check

    Scenario: The Acme Tasks plugin conforms
      When plugin author 3 runs the conformance check
      Then the check reports no problems

    Scenario: An invalid manifest is the only problem reported
      Given the manifest sets "id" to "AcmeTasks"
      When plugin author 3 runs the conformance check
      Then the check reports only one problem, at "manifest: id"

  Rule: The conformance check reports every break with its place

    Scenario Outline: A break in the catalog or the capabilities is reported
      Given <break>
      When plugin author 3 runs the conformance check
      Then the check reports at "<place>" that "<problem>"

      Examples:
        | break                                                   | place                      | problem                                                  |
        | the plugin also implements the registry search          | syncRegistry               | is implemented but capabilities.registry is not declared |
        | the plugin lists "Show a list" twice in its catalog     | syncCatalog                | duplicate key                                            |
        | plugin.yaml gives "Add a task" the match profile "nope" | syncCatalog                | references unknown matchProfile "nope"                   |
        | the plugin gives "Show a list" as a locked read         | syncCatalog                | must be classified write                                 |
        | the plugin gives no literal for "Delete a list"         | summarize                  | typed-confirmation operations must return a confirmLiteral |

    Scenario Outline: A wrong answer to a call is reported with its place
      Given <break>
      When plugin author 3 runs the conformance check
      Then the check reports at "<place>" that "<problem>"

      Examples:
        | break                                                         | place                                  | problem                          |
        | the plugin resolves every request to "Show the open tasks"    | resolveOperation(request [{"method":"delete","path":"/lists/l-1"}]) | resolved to          |
        | the plugin accepts every request for an unknown path          | resolveOperation(request [{"path":"/nope"}]) | expected rejection, got a result |
        | the connection test of the plugin answers "yes" for its result | testConnection                        | ok:                              |
