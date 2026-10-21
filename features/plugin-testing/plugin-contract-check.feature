@id:plugin-contract-check
Feature: Fake upstream server
  A plugin author fakes the upstream service with the fake server of the core testing package.
  The fake server answers only the routes that the test declares, and it keeps each request it receives.
  The compliance suite (@id:plugin-compliance) checks the plugin against core's rules.

  Rule: The fake server answers only the routes that the test declares

    Scenario: A declared route answers, and the fake server keeps the request
      Given plugin author 3 fakes Acme with a route for a list by its name, which needs the API token
      When plugin author 3 asks the fake Acme for the list "Our chores"
      Then the fake Acme answers with the list "Our chores", and kept one request for that list

    Scenario: The fake server keeps the body of each request
      Given plugin author 3 fakes Acme with a route that adds a task to a list
      When plugin author 3 adds "butter" to "Groceries" on the fake Acme
      Then the fake Acme answers with the task "butter", and kept the request with the task "butter" in its body

    Scenario Outline: The fake Acme answers <request> with <answer>
      Given plugin author 3 fakes Acme with a route for a list by its name, which needs the API token
      When plugin author 3 asks the fake Acme for <request>
      Then the fake Acme answers <answer>

      Examples:
        | request                                       | answer                                    |
        | the done tasks of "Groceries"                 | that it has no such route                 |
        | the share password of "Groceries"             | with a server error that says "share is down" |
        | the list "Groceries" without the API token    | that the request is not authorized        |
