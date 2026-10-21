@id:attestation
Feature: Best-practice attestation
  Some writes need the agent to read their best-practice guide first.
  Reading the guide gives the agent a key, and the call must carry that key.
  The key belongs to the session that read the guide and to the current guide version.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write
    And the admin sets the group "tasks" of "tasks" to write

  Rule: A write that needs a guide needs a key from reading it

    Scenario: An import without the guide's key is refused
      When agent 7 imports "flour" and "sugar" into "Groceries" without a key
      Then agent 7 is told to read the guide of "import tasks" first
      And the list "Groceries" still holds the open tasks "milk", "bread" and "eggs"

    Scenario: An import with the key of the guide runs
      Given agent 7 read the guide of "import tasks"
      When agent 7 imports "flour" and "sugar" into "Groceries" with the key of that guide
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs", "flour" and "sugar"

    Scenario: A made-up key is refused
      When agent 7 imports "flour" and "sugar" into "Groceries" with the key "let-me-in"
      Then agent 7 is told to read the guide of "import tasks" first

  Rule: The access level is checked before the guide

    Scenario: An import that the admin turned off is refused as off, not for a missing key
      Given the admin gives "import tasks" its own level none
      When agent 7 imports "flour" and "sugar" into "Groceries" without a key
      Then agent 7 is told that the admin turned "import tasks" off, and is not asked for the guide
      And the list "Groceries" still holds the open tasks "milk", "bread" and "eggs"

  Rule: The key works only in the session that read the guide
    Every MCP call has a session. A unit test covers a key read outside any session.

    Scenario: A key from another session is refused
      Given agent 7 read the guide of "import tasks"
      And agent 7 opens a new session on "tasks"
      When agent 7 imports "flour" and "sugar" into "Groceries" with the key of that guide
      Then agent 7 is told to read the guide of "import tasks" first

  Rule: A new guide version makes old keys stale

    Scenario: A key of an older guide version is refused
      Given agent 7 read the guide of "import tasks"
      And Acme publishes version 2 of the guide of "import tasks"
      And agent 7 reads the guide of "import tasks" again
      When agent 7 imports "flour" and "sugar" into "Groceries" with the key of the first guide
      Then agent 7 is told to read the guide of "import tasks" first

    Scenario: Each guide read is recorded with its version and session
      When agent 7 reads the guide of "import tasks"
      Then the audit log shows that agent 7 read version 1 of the guide of "import tasks" in its session
