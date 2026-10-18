@id:parked-executions
Feature: Parked executions
  An app that cannot show an approval prompt cannot keep a call open until a human decides.
  The run then parks on core. The agent gets the approval link and the id of the run.
  The agent follows the run with resume, until it gets the result.
  Only the credential that started the run, on the same instance, can follow it.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin and may read and write
    And the group "tasks" of "tasks" is at level ask

  Rule: A call parks when the app cannot prompt

    Scenario: The add waits with its approval link
      When the code of agent 7 adds "butter" and then "jam" to "Groceries"
      Then agent 7 is told that the call waits for a human to approve it
      And Acme never receives "butter"

    Scenario: Each approval lets the run go on, and each add runs once
      Given the code of agent 7 adds "butter" and then "jam" to "Groceries"
      When the admin approves each add on its page, and agent 7 resumes the run after each
      Then agent 7 got a second approval link for "jam", and then the new tasks "butter" and "jam"
      And Acme received "butter" once and "jam" once

    Scenario: An app that opens approval links never parks the call
      Given the app of agent 7 opens approval links
      When agent 7 adds "butter" to "Groceries", and the admin approves it on the page the app opened
      Then agent 7 gets the new task "butter" at once, and the call never waited for resume

  Rule: Resume says where the run is
    Resume waits up to 45 seconds for a change before it answers.

    @backlog
    Scenario: Resume before a decision gives the same link again
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When agent 7 resumes the run, and nobody decides for 45 seconds
      Then agent 7 gets the same approval link again, marked as one that it already has

    @backlog
    Scenario: Resume while the code still runs after the decision says that it still runs
      Given a run on "tasks" may take 60 seconds, and Acme takes 50 seconds to answer
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the call and agent 7 resumes it
      Then agent 7 is told that the run still runs, and to resume it again

    Scenario: A second resume at the same time is told that core is busy
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When agent 7 resumes the run twice at the same time, and the admin then approves the add
      Then the second resume is told that another resume already waits on the run
      And the first resume gets the new task "butter"

  Rule: A finished result is collected once

    Scenario: Resume returns the result once, and then the run is gone
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin approves the call and agent 7 resumes it
      When agent 7 resumes the run again
      Then agent 7 is told that no such run exists

    Scenario: A result that nobody collects in 10 minutes is gone
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin approved the call on the approval page, and the run ended
      And 11 minutes pass
      When agent 7 resumes the run
      Then agent 7 is told that no such run exists

  Rule: Only the owner can follow a parked run

    Scenario: Another credential gets the same answer as for a run that core never made
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And agent 7b belongs to the admin and may read and write
      When agent 7b resumes the run of agent 7, and then a run that core never made
      Then agent 7b is told twice that no such run exists
      And the audit log records both resumes by agent 7b

    Scenario: The same credential on another instance cannot follow the run
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When agent 7 resumes the run on the instance "shopping"
      Then agent 7 is told that no such run exists

  Rule: The code continues at the decision

    Scenario: The add runs at the approval, before the agent resumes
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the call on the approval page
      Then Acme receives the add of "butter"
      And the next resume of agent 7 gets the new task "butter"

  Rule: A run parks again only after an approval was given

    Scenario: A loop that retries a denied add is not asked again
      Given the code of agent 7 tries three times to add "butter" to "Groceries"
      When the admin denies the add on its page, and agent 7 resumes the run
      Then agent 7 gets three denials, and only the first add was asked
      And agent 7 can leave two more calls waiting for approval

    Scenario: In the session, a denied form does not stop the next form
      Given the admin lets the session approve calls on "tasks"
      And the app of agent 7 shows only forms, declines the first and accepts the next
      When the code of agent 7 tries to add "butter", and then adds "jam" to "Groceries"
      Then the app of agent 7 showed two forms
      And the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "jam"

    Scenario: The eleventh approval of one run is refused at once
      Given the admin gives "count the tasks" its own level ask
      When the code of agent 7 counts "Groceries" eleven times, and the admin approves each count
      Then agent 7 gets ten counts, and the eleventh is refused because the run reached its approval limit

  Rule: Parked runs have limits
    One credential can leave two runs parked on one instance. One instance holds eight parked runs.

    Scenario: A third parked run of one credential on one instance is denied
      Given agent 7 has two adds that wait for approval
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that too many earlier calls still wait for approval

    Scenario Outline: <agent> on "<instance>" still has room
      Given agent 7 has two adds that wait for approval
      And agent 7b belongs to the admin and may read and write
      When <agent> adds "butter" to "Groceries" on the instance "<instance>"
      Then <agent> is told that the call waits for a human to approve it

      Examples:
        | agent    | instance |
        | agent 7b | tasks    |
        | agent 7  | shopping |

    Scenario: Eight parked runs fill the instance for every credential
      Given agents 1, 2, 3 and 4 of the admin each have two adds that wait for approval
      And agent 5 belongs to the admin and may read and write
      When agent 5 adds "butter" to "Groceries"
      Then agent 5 is told that too many earlier calls still wait for approval

  Rule: A parked run ends with its instance or with core

    Scenario: Stopping the instance ends the run, and resume says so
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin disables the instance "tasks"
      When the admin enables "tasks" again, and agent 7 resumes the run
      Then agent 7 is told that the run ended

    Scenario: A run from before a restart of core is unknown
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And core restarts
      When agent 7 resumes the run
      Then agent 7 is told that no such run exists

    Scenario: The audit log shows the wait, the decision and each resume
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the call and agent 7 resumes it
      Then the audit log shows that the add of "butter" waited, the admin approved it, and agent 7 resumed the run once
