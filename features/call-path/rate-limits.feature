@id:rate-limits
Feature: Rate limits
  Each credential has its own budget of runs and of writes on an instance.
  Only a few runs go at once on an instance.
  The admin sets the budgets in the settings of the instance, and the total of runs at once in the settings of the server.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write
    And "tasks" allows each credential 2 writes a minute

  Rule: Each credential has a run budget

    Scenario: The third run in a minute is refused
      Given "tasks" allows each credential 2 runs a minute
      And agent 7 counted "Groceries" three times in one run, and searched the catalog once
      When agent 7 runs code that returns 1
      Then agent 7 is told that it made too many runs, and to slow down

    Scenario: Another credential has its own run budget
      Given "tasks" allows each credential 2 runs a minute
      And agent 7b belongs to the admin and may read and write
      And agent 7 used up its runs
      When agent 7b runs code that returns 1
      Then agent 7b gets the value 1

    Scenario: Two credentials with the same name have separate run budgets
      Given "tasks" allows each credential 2 runs a minute
      And agents 7 and 7b each have a credential of the admin named "Claude"
      And agent 7 used up its runs
      When agent 7b runs code that returns 1
      Then agent 7b gets the value 1

  Rule: The write budget counts only writes that run

    Scenario: Denied writes do not use the write budget
      Given the admin denied three adds of agent 7
      And the admin sets the group "tasks" of "tasks" to write
      And agent 7 added "butter" and "jam" to "Groceries"
      When agent 7 adds "honey" to "Groceries"
      Then agent 7 is told that it made too many writes, and to slow down

    Scenario: Another credential has its own write budget
      Given the admin sets the group "tasks" of "tasks" to write
      And agent 7 added "butter" and "jam" to "Groceries"
      And agent 7b belongs to the admin and may read and write
      When agent 7b adds "honey" to "Groceries"
      Then the list "Groceries" holds the open task "honey"

    Scenario: A session approval does not lift the write budget
      Given the admin approved the add of "butter" by agent 7 for this session
      And agent 7 added "jam" to "Groceries"
      When agent 7 adds "honey" to "Groceries"
      Then agent 7 is told that it made too many writes, and to slow down

  Rule: Only a few runs go at once, and a run waits up to 2 seconds for a place

    Scenario: A fifth run that waits 2 seconds is told that core is busy
      Given Acme takes 3 seconds to answer
      And agent 7 started four reads of "Groceries" that wait for Acme
      When agent 7 runs code that returns 1
      Then agent 7 is told after 2 seconds that core is busy

    Scenario: A fifth run waits for a place, then runs
      Given Acme takes 1 second to answer
      And agent 7 started four reads of "Groceries" that wait for Acme
      When agent 7 runs code that returns 1
      Then agent 7 gets the value 1 once one of the four reads ends

    Scenario: A cancelled run gives up its wait
      Given Acme takes 3 seconds to answer
      And agent 7 started four reads of "Groceries" that wait for Acme
      When agent 7 cancels a run that waits for a place
      Then the cancelled run never reaches Acme, and agent 7 is not kept waiting

    Scenario: A run that waits for approval gives its place back
      Given agent 7b belongs to the admin and may read and write
      And agents 7 and 7b each wait for the admin to approve two adds
      When agent 7 runs code that returns 1
      Then agent 7 gets the value 1

  Rule: The admin sets how many runs go at once

    Scenario: The admin lets more runs go at once on an instance
      Given Acme takes 3 seconds to answer
      And the admin lets 5 runs go at once on "tasks"
      And agent 7 started four reads of "Groceries" that wait for Acme
      When agent 7 runs code that returns 1
      Then agent 7 gets the value 1 without waiting

    Scenario: An instance cannot take every place
      Given the server lets 16 runs go at once in total
      When the admin tries to let 16 runs go at once on "tasks"
      Then the admin is told that "tasks" may have at most 15 runs, one less than the total, and its limit stays at 4

    Scenario: The server lets 16 runs go at once for each CPU unless the admin changes it
      Given the server has 2 CPUs
      When the admin opens the run limits of the server
      Then the admin sees that 32 runs may go at once in total, and that this is the default

    Scenario: The admin lowers the total, and an instance still keeps one place free
      Given the admin lets 8 runs go at once in total on the server
      When the admin tries to let 8 runs go at once on "tasks"
      Then the admin is told that "tasks" may have at most 7 runs, one less than the total, and its limit stays at 4

    Scenario: A limit below 1, or a total above 256, is refused
      When the admin tries to let 0 runs go at once on "tasks", and 257 in total on the server
      Then the admin is told that an instance limit must be at least 1 and the total between 2 and 256, and both stay
