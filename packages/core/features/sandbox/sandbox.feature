@id:sandbox
Feature: Sandbox
  The code of an agent runs in a sandbox that holds only the to-do functions of its instance.
  The code cannot reach core or the host. It runs within a time limit and a memory limit.
  Each run starts empty, and a result or a log that is too large is cut.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write

  Rule: Code runs and returns its value

    Scenario: The code returns an object and logs a line
      When the code of agent 7 reads the open tasks of "Groceries", logs how many it found and returns the first
      Then agent 7 gets the first task "milk" and the count 3
      And agent 7 sees the log line "found 3 tasks"

    Scenario: Code that returns nothing gives no value
      When the code of agent 7 counts the open tasks of "Groceries" and returns nothing
      Then agent 7 gets no value

  Rule: A failed run tells the agent why

    Scenario: Code that throws gives its message
      When the code of agent 7 throws the error "no milk today"
      Then agent 7 is told that its code failed with "no milk today"

    Scenario: Code with broken syntax does not run
      When agent 7 sends code with broken syntax
      Then agent 7 is told that its code has a syntax error
      And Acme received no request from agent 7

  Rule: Waiting on an approval does not use the time limit

    Scenario: The code goes on after an approval that took longer than the time limit
      Given a run on "tasks" may take 1 second
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the add of "butter" still waits after 2 seconds
      When the admin approves the call and agent 7 resumes it
      Then agent 7 gets the new task "butter"

    Scenario: A slow answer from Acme uses the time limit
      Given a run on "tasks" may take 1 second, and Acme takes 2 seconds to answer
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 is told that Acme did not answer in time

  Rule: Large results and logs are cut

    Scenario: A result over 64 KB is cut to a preview
      When the code of agent 7 returns 100 KB of text
      Then agent 7 gets a cut result with its full size and a preview of 64 KB

    Scenario: Logs over 16 KB are cut
      When the code of agent 7 logs 100 KB of text
      Then the logs of agent 7 stop at 16 KB

    Scenario: The preview of a cut result does not show the API token
      Given Acme has a task in "Groceries" whose title quotes the API token
      When the code of agent 7 returns the open tasks of "Groceries" with 100 KB of padding
      Then the preview of agent 7 shows [REDACTED] in place of the API token

  Rule: Code cannot reach the host

    Scenario: The code finds no modules, no process, no network and no timers
      When the code of agent 7 looks for modules, the process, the network and timers
      Then agent 7 finds none of them

    Scenario: A function built from a to-do function reaches nothing
      When the code of agent 7 builds new functions from the constructor of "tasks.call"
      Then the new functions of agent 7 find no process and no modules

    Scenario: The global scope holds none of the helpers of core
      When the code of agent 7 searches the global scope for the helpers of core
      Then agent 7 finds none of them

  Rule: The to-do functions cannot be changed

    Scenario: The code cannot replace a to-do function
      When the code of agent 7 replaces "tasks.call" with its own function
      Then the code of agent 7 is refused, because "tasks.call" is read-only
      And Acme received no request from agent 7

    Scenario: Inherited names are not to-do functions
      When the code of agent 7 looks for the to-do functions that "tasks" inherits
      Then agent 7 finds only the to-do function "call", and nothing inherited

  Rule: Endless code is stopped

    Scenario: A loop that never ends is stopped
      Given a run on "tasks" may take 1 second
      When the code of agent 7 loops forever
      Then agent 7 is told that the run went over its time limit

    Scenario: Calls to Acme in a loop that never ends are stopped
      Given a run on "tasks" may take 1 second
      When the code of agent 7 counts the open tasks of "Groceries" in a loop that never ends
      Then agent 7 is told that the run went over its time limit

    Scenario: Code that fills the memory is stopped
      Given a run on "tasks" may use 16 MB of memory
      When the code of agent 7 fills the memory without end
      Then agent 7 is told that the run went over its memory limit

  Rule: Runs do not share state

    Scenario: A global value of one run is gone in the next run
      Given the code of agent 7 left the global value "leak" in an earlier run
      When the code of agent 7 looks for the global value "leak"
      Then agent 7 does not find "leak"
