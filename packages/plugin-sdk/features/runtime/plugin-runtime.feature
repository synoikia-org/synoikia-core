@id:plugin-runtime
Feature: Plugin runtime
  Core starts the "Acme Tasks" plugin of plugin author 3 as its own process and sends it requests over a message channel.
  The SDK answers for the plugin. It maps errors, waits for the connection and protects result secrets on an old core.
  Shared work inside the plugin never keeps a failure.

  Background:
    Given Acme Tasks has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme Tasks describes its API in an OpenAPI 3.0 description
    And plugin.yaml of the plugin keeps the result of "Create an API token" secret and locks "Delete a list" with a twin for other users

  Rule: The plugin answers only the methods it implements

    Scenario Outline: A method that the plugin does not implement is not found
      Given core started the plugin
      When core sends the plugin the method "<method>"
      Then core gets a method-not-found error

      Examples:
        | method       |
        | doesNotExist |
        | getGuide     |
        | constructor  |
        | toString     |

    Scenario: A plugin error keeps its code
      Given core connected the plugin to Acme Tasks
      When core asks the plugin to resolve the request {path: /nope}
      Then core gets an unknown-operation error "/nope is not an operation of the Acme Tasks API"

    Scenario: A description that is not valid reaches core as an upstream error that names Acme Tasks
      Given core connected the plugin to Acme Tasks
      And Acme Tasks gives an OpenAPI 2 description
      When core syncs the catalog
      Then core gets an upstream error "The Acme Tasks API description is not valid: The Acme Tasks API spec is not OpenAPI 3"

  Rule: On an old core the plugin protects result secrets itself

    Scenario: Core 0.2.1 gets no catalog and no token, and the read still runs
      Given core connected the plugin to Acme Tasks with the contract "0.2.1"
      When core syncs the catalog, then calls "Create an API token" and "Show the open tasks" of "Groceries"
      Then the sync and the token call are refused with "declares result secrets" and "require ^0.2.2"
      And Acme Tasks makes no token
      And the read gives "milk", "bread" and "eggs"

    Scenario: A core with an unknown contract makes the plugin sync its catalog once on its own
      Given core connected the plugin to Acme Tasks with the contract "not-a-version"
      When core calls "Create an API token", then "Show the open tasks" of "Groceries"
      Then the token call is refused with "declares result secrets"
      And Acme Tasks served its description once
      And the read gives "milk", "bread" and "eggs"

    Scenario: Core 0.2.2 masks result secrets itself, so the plugin refuses nothing
      Given core connected the plugin to Acme Tasks with the contract "0.2.2"
      When core syncs the catalog, then calls "Create an API token"
      Then the catalog keeps the whole result of "Create an API token" secret, and the call gives the token "acme-tok-1a2b3c4d"

  Rule: A plugin waits for its connection and swaps it safely

    Scenario: A request before the connection is refused
      Given core started the plugin
      When core asks the plugin to resolve the request {path: /lists}
      Then core gets an internal error "init has not been called"

    Scenario: A new connection closes the old one and loads the catalog again
      Given core connected the plugin to Acme Tasks and synced the catalog twice
      When core connects the plugin again and syncs the catalog
      Then the plugin closed its first connection, and Acme Tasks served its description twice

    Scenario: An invalid new connection keeps the old one
      Given core connected the plugin to Acme Tasks
      When core connects the plugin again with no base address
      Then core gets an invalid-parameters error "baseUrl is required"
      And the plugin closed no connection, and still reads "milk", "bread" and "eggs" of "Groceries"

  Rule: A connection test reports a failure as a message, and calls get at least one second

    Scenario: A good connection test gives the version of Acme Tasks
      Given core connected the plugin to Acme Tasks
      When core tests the connection
      Then the test passes with the version "Acme Tasks 4.2"

    Scenario: A failed connection test gives the reason
      Given core connected the plugin to Acme Tasks with the revoked API token "acme-tok-0000"
      When core tests the connection
      Then the test fails with "insufficient permission (token revoked)"

    Scenario: A call with 10 milliseconds left still waits one second for Acme Tasks
      Given core connected the plugin to Acme Tasks
      And Acme Tasks answers after 500 milliseconds
      When core calls "Show the open tasks" of "Groceries" with 10 milliseconds left
      Then the read gives "milk", "bread" and "eggs"

  Rule: Shared work never keeps a failure

    Scenario: Two calls at the same time share one sign-in
      Given Acme Tasks takes a session sign-in instead of the token
      And core connected the plugin to Acme Tasks with a session sign-in
      When core calls "Show the open tasks" of "Groceries" twice at the same time
      Then the plugin signed in to Acme Tasks once

    Scenario: A failed catalog load is not kept
      Given core connected the plugin to Acme Tasks
      And the first catalog sync failed because Acme Tasks did not serve its description
      When core syncs the catalog
      Then core gets the catalog with "Show the open tasks"

    Scenario: A catalog load that ends after a new connection is dropped
      Given core connected the plugin to Acme Tasks
      And a slow catalog sync is still loading when core connects the plugin again
      And Acme Tasks then renames "Show the open tasks" to "Show the tasks to do"
      When core syncs the catalog
      Then core gets the catalog with "Show the tasks to do"

  Rule: Waiting requests fail together

    Scenario: Requests that wait on a closed live channel all fail
      Given the plugin waits on a live channel of Acme Tasks for "lists.watch" and "tasks.watch"
      When the live channel closes with "connection closed"
      Then both requests fail with "connection closed"

    Scenario: A request with no answer times out
      When the plugin waits 20 milliseconds for "lists.watch" on a live channel that does not answer
      Then the plugin gets the upstream error "lists.watch: timed out"

  Rule: Group names are valid, and twin keys split and join

    Scenario Outline: A tag of Acme Tasks becomes a valid group name
      Given Acme Tasks tags "Show the open tasks" with "<tag>"
      When plugin author 3 builds the catalog from the description
      Then "Show the open tasks" is in the group "<group>"

      Examples:
        | tag             | group           |
        | Shopping Lists! | shopping_lists_ |
        | __Tasks         | tasks           |
        | !!!             | other           |

    Scenario: Core calls the twin, and the plugin acts on the list of the base operation
      Given Acme Tasks has the list "Chores" of another user
      And core connected the plugin to Acme Tasks
      When core resolves and runs the request {method: delete, path: /lists/l-2}
      Then the plugin resolved "Delete a list" for "other-user", and Acme Tasks no longer has the list "Chores"
