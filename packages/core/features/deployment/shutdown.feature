@id:shutdown
Feature: Shutdown
  The operator stops core with a signal. Core stops quickly, also with open connections.
  An approval that still waits is denied, and its agent is told why.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: A stop is quick and denies open approvals

    Scenario: A stop with a live portal, an agent session and an open approval ends within 2 seconds
      Given the admin watches the live view of the portal
      And agent 7, whose app opens approval links, adds "butter" to "Groceries" and waits on the link
      When the operator stops the server
      Then the server stopped within 2 seconds, and the live view of the portal ended
      And agent 7 is told that the add was denied by the shutdown

    @long-running
    Scenario: The next start denies an approval that a crash left waiting, with a warning
      Given agent 7 left the add of "butter" to "Groceries" waiting on a server that then crashed
      When the server starts again
      Then the server log warns that it denied 1 approval left waiting by the previous run
      And the admin sees the same warning in the overview

    @long-running
    Scenario: A second server on the same data directory is refused
      When a second server starts on the data directory of the running server
      Then the second server stops at once, because another server uses the data directory
