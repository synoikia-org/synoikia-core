@id:approval-channels
Feature: Approval channels
  A call that needs a human decision reaches a human in the way the app of the agent supports.
  An app that opens links sends the human to the approval page.
  An app that shows forms can approve plain calls in the session, but only where the admin allows it.
  Otherwise the call waits, and the agent gets the approval link.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "dishes"
    And agent 7 belongs to the admin and may read and write
    And the group "tasks" of "tasks" is at level ask

  Rule: An app with page prompts sends the user to the approval page

    Scenario: The admin approves the add on the page that the app opened
      Given the app of agent 7 opens approval links
      When agent 7 adds "butter" to "Groceries", and the admin approves it on the page the app opened
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"
      And the approval link no longer opens
      And the audit log shows that the admin approved the add of "butter" on the approval page

    Scenario: The prompt names the operation and never the share password
      Given the admin sets the group "lists" of "tasks" to ask
      And the app of agent 7 opens approval links
      When agent 7 starts to rename "Chores" to "Housework" with the share password "chores-share-3"
      Then the app of agent 7 shows a prompt that names "rename a list"
      And the prompt does not show "chores-share-3"

    Scenario Outline: A declined or dismissed prompt is a denial
      Given the app of agent 7 opens approval links, and the user <answer> them
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the add was declined in the app
      And the list "Groceries" still holds the open tasks "milk", "bread" and "eggs"

      Examples:
        | answer    |
        | declines  |
        | dismisses |

  Rule: The app never approves its own call by default

    Scenario: A form-only app is never asked while the instance keeps in-session approval off
      Given the app of agent 7 shows only forms, and accepts them
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the call waits for a human to approve it
      And the app of agent 7 was never asked

    Scenario: An app that cannot show the prompt gets a denial
      Given the app of agent 7 opens approval links, but fails to show them
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that its app could not show the approval prompt

  Rule: An opted-in instance lets the session approve plain calls

    Background:
      Given the admin lets the session approve calls on "tasks"

    Scenario: The form has no fields, and Accept approves the add
      Given the app of agent 7 shows only forms, and accepts them
      When agent 7 adds "butter" to "Groceries"
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"
      And the app of agent 7 showed one form with no fields
      And the audit log shows that the app of agent 7 approved the add of "butter" in the session

    Scenario Outline: A declined, dismissed or failed form is a denial
      Given the app of agent 7 shows only forms, and <answer> them
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that <reason>

      Examples:
        | answer        | reason                                     |
        | declines      | the add was denied                         |
        | dismisses     | the add was denied                         |
        | fails to show | its app could not show the approval prompt |

    Scenario: A read at its own level ask is approved in the session too
      Given the admin gives "show the open tasks" its own level ask
      And the app of agent 7 shows only forms, and accepts them
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs"
      And the app of agent 7 showed one form with no fields

  Rule: The session never approves locked or typed-confirmation calls

    Background:
      Given the admin lets the session approve calls on "tasks"

    Scenario Outline: A form-only app never gets a form to <action> a list
      Given the admin gives "<operation>" its own level ask
      And the app of agent 7 shows only forms, and accepts them
      When agent 7 <does> the list "Chores"
      Then agent 7 is told that the call waits for a human to approve it
      And the app of agent 7 was never asked

      Examples:
        | action  | operation      | does     |
        | delete  | delete a list  | deletes  |
        | archive | archive a list | archives |

    Scenario: An app with forms and links gets a form for the add and a link for the delete
      Given the admin gives "delete a list" its own level ask
      And the app of agent 7 shows forms and opens links, and the admin approves each link with the list name
      When agent 7 adds "butter" to "Groceries" and then deletes the list "Chores"
      Then the app of agent 7 showed a form for the add and an approval link for the delete
      And Acme no longer has the list "Chores"

  Rule: An unknown stored in-session setting reads as off
    An earlier release of core stored the in-session setting "writes". Core does not know this value now.

    Scenario: A stored value that core does not know sends the add to the page
      Given the database of "tasks" holds the in-session setting "writes"
      And the app of agent 7 shows forms and opens links, and the admin approves each link with the list name
      When agent 7 adds "butter" to "Groceries"
      Then the app of agent 7 showed only an approval link

    Scenario: Core removes a stored value that it does not know when it starts
      Given the database of "tasks" holds the in-session setting "writes"
      When core restarts
      Then the admin sees one warning that in-session approvals on "/tasks" were turned off

  Rule: A caller with no channel is denied at once
    Over MCP a caller can always leave a call waiting, so only the plugin harness has no channel.

    Scenario: A harness run with no way to ask a human is denied at once
      Given plugin author 3 runs the plugin of "tasks" in the plugin harness, with the group "tasks" at level ask
      When the harness run adds "butter" to "Groceries" with no way to ask a human
      Then the harness run is told that the add needs approval and it cannot show approval prompts

  Rule: An unanswered form falls back to the link
    Core waits 30 seconds for an answer to a form.
    Then the call waits with its approval link, if the agent can leave one more call waiting.

    Background:
      Given the admin lets the session approve calls on "tasks"

    Scenario: An unanswered form moves to the approval link
      Given the app of agent 7 shows only forms, and accepts them after the form wait has passed
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the call waits for a human, who can also approve it in the session
      And the late answer of the form adds nothing, and the approval link still opens
      And the audit log shows that the add of "butter" moved from the form to the approval link

    Scenario: A form answered in time never moves to the link
      Given the app of agent 7 shows only forms, and accepts them
      When agent 7 adds "butter" to "Groceries"
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"
      And the audit log shows only that the app of agent 7 approved the add of "butter" in the session

    Scenario: A form stays open while the agent cannot leave more calls waiting
      Given agent 7 has two adds that wait for approval
      And the app of agent 7 shows only forms, and accepts them after the form wait has passed
      When agent 7 adds "butter" to "Groceries"
      Then the list "Groceries" holds the open task "butter"
      And the audit log shows that the app of agent 7 approved the add of "butter" in the session

  Rule: Nobody deciding in time is a denial

    @long-running
    Scenario: An approval that nobody decides in time is denied
      Given approvals on "tasks" expire after 10 seconds, and a run may take 2 seconds
      And the app of agent 7 opens approval links
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the approval of the add timed out and was denied
      And the audit log shows that the add of "butter" timed out

    Scenario: An approval link expires after 15 minutes by default
      When agent 7 adds "butter" to "Groceries"
      Then agent 7 is told that the approval link expires in 15 minutes

  Rule: Access is checked again after the approval

    Scenario: The admin lowers the group while the add waits
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin sets the group "tasks" to read
      When the admin approves the call and agent 7 resumes it
      Then agent 7 is told that "add a task" was turned off while it waited

    Scenario: The own ask of a read goes to none while the read waits
      Given the admin gives "show the open tasks" its own level ask
      And agent 7 waits for the admin to approve the open tasks of "Groceries"
      And the admin gives "show the open tasks" its own level none
      When the admin approves the call and agent 7 resumes it
      Then agent 7 is told that "show the open tasks" was turned off while it waited

    Scenario: The credential of the agent is revoked while the add waits
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin revokes the credential of agent 7
      When the admin approves the call on the approval page
      Then the audit log shows that the add of "butter" was refused because the credential was revoked
      And Acme never receives "butter"

  Rule: One approval is good for one call

    Scenario: A second decision on the same approval is refused
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin approved the call on the approval page
      When the admin sends the decision again from the same page
      Then the admin is told that the approval request expired or was already decided

    Scenario: An approval link that core never made opens nothing
      When the admin opens an approval link that core never made
      Then the admin is told that the approval request expired or was already decided

  Rule: Approvals end with core, the instance or the owner

    Scenario: A restart of core ends the open approval
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When core restarts
      Then the approval link no longer opens
      And the audit log shows that the restart ended the add of "butter"

    Scenario: Disabling the instance ends the open approval
      Given the app of agent 7 opens approval links
      And agent 7 started to add "butter" to "Groceries"
      When the admin disables the instance "tasks"
      Then agent 7 is told that the add was cancelled because the instance stopped
      And the approval link no longer opens

    Scenario: Deleting the owner ends the approvals of their agents
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And agent 9 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin deletes user 12
      Then the approval link no longer opens
      And the audit log shows that the add of "butter" was denied
