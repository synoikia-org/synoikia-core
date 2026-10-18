@id:session-grants
Feature: Session grants
  On the approval page, the owner can approve a call for this session.
  This gives a session grant to the credential of the agent on that instance.
  Until the grant ends, the asks of that credential on that instance run without a question.
  A session grant never covers locked calls or calls with a typed confirmation.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "dishes"
    And agent 7 belongs to the admin and may read and write
    And the group "tasks" of "tasks" is at level ask

  Rule: A session grant lets later asks of the agent run

    Scenario: Later adds of agent 7 run without a question
      Given the admin approved the add of "butter" by agent 7 for this session
      When agent 7 adds "jam" to "Groceries"
      Then agent 7 gets the new task "jam" without a question
      And the audit log shows that the session grant approved the add of "jam"

    Scenario: The session grant of agent 7 does not cover agent 7b
      Given the admin approved the add of "butter" by agent 7 for this session
      And agent 7b belongs to the admin and may read and write
      When agent 7b adds "jam" to "Groceries"
      Then agent 7b is told that the call waits for a human to approve it

    Scenario: A length that the page did not offer is refused
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the add for this session for 99 hours
      Then the admin is told to choose a session length
      And the call of agent 7 still waits for a decision

  Rule: A session grant never covers locked calls, typed confirmations or what the credential cannot do

    Scenario Outline: The <action> of a list still asks under a session grant
      Given the admin gives "<operation>" its own level ask
      And the admin approved the add of "butter" by agent 7 for this session
      When agent 7 <does> the list "Chores"
      Then agent 7 is told that the call waits for a human to approve it
      And the approval page of the call offers no session grant

      Examples:
        | action  | operation      | does     |
        | delete  | delete a list  | deletes  |
        | archive | archive a list | archives |

    Scenario: A session grant does not lift a read-only credential
      Given the admin gave agent 7 a read-only credential instead
      And the admin gives "show the open tasks" its own level ask
      And the admin approved the open tasks of "Groceries" for agent 7 for this session
      When agent 7 adds "jam" to "Groceries"
      Then agent 7 is told that its credential has read-only access

    Scenario: With a longest session grant of 0 hours, the page offers none and refuses a forged one
      Given the longest session grant on "tasks" is 0 hours
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the add for this session for 1 hour
      Then the page offered no session grant, and the admin is told to choose a session length
      And the call of agent 7 still waits for a decision

  Rule: One session grant for each credential and instance, until it ends

    Scenario: A second session grant replaces the first
      Given agent 7 waits for the admin to approve the adds of "salt" and "pepper"
      When the admin approves both adds for this session
      Then the admin sees one session grant of agent 7 on "tasks"
      And the audit log shows that the session grant of agent 7 ended because a new one replaced it

    Scenario Outline: The session grant ends when <event>
      Given the admin approved the add of "butter" by agent 7 for this session
      When <action>
      Then the admin sees no session grant on "tasks"
      And the audit log shows that the session grant of agent 7 ended because <reason>

      Examples:
        | event                | action                                          | reason                |
        | its time is up       | 61 minutes pass                                 | it expired            |
        | the admin revokes it | the admin revokes the session grant of agent 7  | the admin revoked it  |
        | the instance stops   | the admin disables the instance "tasks"         | the instance stopped  |

    Scenario Outline: The session grant ends when the admin <action> its approver
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And user 12 approved the add of "butter" by agent 9 for this session
      When the admin <action> user 12
      Then the audit log shows that the session grant of agent 9 ended because user 12 was <state>

      Examples:
        | action   | state    |
        | disables | disabled |
        | deletes  | deleted  |

  Rule: Only the agent itself or the admin ends a session grant early

    Scenario: Agent 7 revokes its session grant, and the next add asks again
      Given the admin approved the add of "butter" by agent 7 for this session
      And the approval card of agent 7 revokes its session grant
      When agent 7 adds "jam" to "Groceries"
      Then agent 7 is told that the call waits for a human to approve it

    Scenario: Agent 7b cannot revoke the session grant of agent 7
      Given the admin approved the add of "butter" by agent 7 for this session
      And agent 7b belongs to the admin and may read and write
      When the approval card of agent 7b tries to revoke the session grant of agent 7
      Then the card of agent 7b is told that nothing was revoked
      And the admin sees one session grant of agent 7 on "tasks"
