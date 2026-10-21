@id:approval-card
Feature: Approval card
  An app that shows MCP apps shows the approval card next to a call that waits for approval.
  The card shows the state of the parked run.
  Where the instance lets the session approve calls, the card can also approve or deny the call.
  The card works only for the credential that started the run.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "dishes"
    And agent 7 belongs to the admin and may read and write
    And the group "tasks" of "tasks" is at level ask

  Rule: The card decides only in-session approvals of its own credential

    Scenario: The card approves the add where the instance allows it
      Given the admin lets the session approve calls on "tasks"
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the user approves the call on the approval card of agent 7, and agent 7 resumes the run
      Then agent 7 gets the new task "butter"
      And the audit log shows that the approval card of agent 7 approved the add of "butter", with no session grant

    Scenario: The card of another credential cannot find the run
      Given the admin lets the session approve calls on "tasks"
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And agent 7b belongs to the admin and may read and write
      When the user approves the call of agent 7 on the approval card of agent 7b
      Then the card of agent 7b is told that the run does not exist

    Scenario Outline: The card cannot decide <call> while in-session approval is <setting>
      Given the admin gives "delete a list" its own level ask
      And in-session approval on "tasks" is <setting>
      And agent 7 waits for the admin to approve <call>
      When the user approves the call on the approval card of agent 7
      Then the card of agent 7 is told that the call needs the approval page

      Examples:
        | call                               | setting |
        | the add of "butter" to "Groceries" | off     |
        | deleting the list "Chores"         | on      |

  Rule: A stale card decides nothing

    Scenario: A card for an approval that the run has passed is told that the approval changed
      Given the code of agent 7 adds "butter" and then "jam" to "Groceries"
      And the admin approved the add of "butter" on its page, and the run now waits for "jam"
      When the user approves the add of "butter" on the approval card of agent 7
      Then the card of agent 7 is told that the approval changed

    Scenario: A card for a decided call decides nothing
      Given the admin lets the session approve calls on "tasks"
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the user approved the call on the approval card of agent 7
      When the user approves the call on the approval card of agent 7 again
      Then the card of agent 7 is told that the run does not exist

    Scenario: Turning in-session approval off while the call waits ends the run
      Given the admin lets the session approve calls on "tasks"
      And agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And in-session approval on "tasks" is off
      When the user approves the call on the approval card of agent 7
      Then the card of agent 7 is told that the run does not exist

  Rule: The card shows only the state

    Scenario: The card sees that the add was approved and done, and nothing more
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin approved the call on the approval page
      When the approval card of agent 7 reads the state of the run after it ended
      Then the card sees only that the run is done and was approved, without the task or the approver

    Scenario: The card sees that a resume waits, so the chat continues by itself
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When agent 7 resumes the run, and the approval card reads the state meanwhile
      Then the card sees that the run waits for approval, and that a resume waits on it

    Scenario: The card reaches no other site and keeps its tools from the model
      When the app of agent 7 loads the approval card and the tools of "tasks"
      Then the card may reach no other site
      And the tools of the card are only for the app, not for the model
