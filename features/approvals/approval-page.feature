@id:approval-page
Feature: Approval page
  A human decides a call that waits for approval on the approval page of core.
  Only the owner of the credential that made the call can decide it.
  The page has its own sign-in. The access gateway in front of core can also sign the owner in.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And Acme also has the list "Chores" with the open task "dishes"
    And agent 7 belongs to the admin and may read and write
    And the group "tasks" of "tasks" is at level ask

  Rule: Opening the link decides nothing

    Scenario: The admin opens the link and sees the call, and nothing is decided
      Given the admin sets the group "lists" of "tasks" to ask
      And agent 7 waits for the admin to approve renaming "Chores" to "Housework" with the share password "chores-share-3"
      When the admin opens the approval link and signs in
      Then the admin sees "rename a list" for "Chores", signed in as admin, without "chores-share-3"
      And the call of agent 7 still waits for a decision

    Scenario: A decision without the form token decides nothing
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin sends an approval without the form token
      Then the admin is told that the form expired
      And the call of agent 7 still waits for a decision

    Scenario: After the approval, the page sends the admin back to the chat
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the add on the approval page
      Then the admin is told that the add was approved, and to return to the chat of agent 7
      And the approval link no longer opens

  Rule: The form belongs to this approval, this approver and this browser

    Scenario Outline: A form token from somewhere else is refused
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin sends an approval with a form token <source>
      Then the admin is told that the form expired
      And the call of agent 7 still waits for a decision

      Examples:
        | source                             |
        | from the page of another approval  |
        | from another browser of the admin  |
        | copied from the cookie of the page |
        | with one character changed         |

  Rule: Only the owner of the credential decides
    Every credential has an owner, so a call without one cannot reach the page. A unit test covers that guard.

    Scenario: The admin cannot see or decide the call of agent 9
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And agent 9 waits for user 12 to approve the add of "butter" to "Groceries"
      When the admin opens the approval link and signs in
      Then the admin is told that the approval request belongs to another user, with no details
      And the admin cannot approve it

  Rule: A typed confirmation must match exactly

    Background:
      Given the admin gives "delete a list" its own level ask

    Scenario Outline: A confirmation that does not match exactly is refused
      Given agent 7 waits for the admin to approve deleting the list "Chores"
      When the admin approves the delete with the confirmation <typed>
      Then the admin is told to type "Chores" exactly to approve
      And the admin can still deny the delete on the same page
      And Acme still has the list "Chores"

      Examples:
        | typed    |
        | ""       |
        | "nope"   |
        | "CHORES" |

    Scenario: The exact list name approves the delete
      Given agent 7 waits for the admin to approve deleting the list "Chores"
      When the admin approves the delete with the confirmation "Chores" and agent 7 resumes it
      Then Acme no longer has the list "Chores"

    Scenario: A delete without a confirmation from the plugin is refused
      Given the plugin of "tasks" gives no typed confirmation
      When agent 7 deletes the list "Chores"
      Then agent 7 is told that the plugin gave no confirmation for "delete a list"
      And Acme still has the list "Chores"

  Rule: The approval page has its own sign-in

    Scenario: A user without two-factor signs in on the page and approves
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the call and agent 7 resumes it
      Then the list "Groceries" holds the open tasks "milk", "bread", "eggs" and "butter"
      And the audit log shows that the admin approved the add of "butter" after a sign-in on the page

    Scenario: With two-factor required, a user without it cannot sign in on the page
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin requires two-factor sign-in for everyone
      When the admin opens the approval link and signs in
      Then the admin is told that core requires two-factor authentication
      And the approval link still asks the admin to sign in

    Scenario Outline: The page keeps its sign-in for hours, within the idle limit
      Given the admin approved an add of agent 7 on the approval page, and keeps the browser open
      And the idle limit of the approval page is <limit> hours
      And <hours> hours pass, and agent 7 waits for the admin to approve the add of "jam" to "Groceries"
      When the admin opens the new approval link in the same browser
      Then the admin <sees>

      Examples:
        | limit | hours | sees                                |
        | 12    | 3     | sees the add, signed in as admin    |
        | 1     | 2     | is asked to sign in again           |

    @backlog
    Scenario: A sign-in on the approval page is no sign-in for an app's consent
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      And the admin signed in on the approval page
      When the admin opens the consent page of a new app in the same browser
      Then the admin is asked to sign in again

  Rule: The access gateway can sign the owner in
    The access gateway is a Cloudflare Access application. It tells core who the person in the browser is.

    Background:
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And the access gateway signs people in for core

    Scenario: The gateway signs user 12 in, and user 12 approves
      Given agent 9 waits for user 12 to approve the add of "butter" to "Groceries"
      When user 12 approves the add through the access gateway
      Then the page showed that the access gateway signed in user 12
      And Acme receives the add of "butter"
      And the audit log shows that user 12 approved the add of "butter" after a sign-in by the gateway

    Scenario Outline: The gateway names someone who cannot decide
      Given agent 9 waits for user 12 to approve the add of "butter" to "Groceries"
      When the access gateway sends the approval link with <identity>
      Then the browser gets <page>

      Examples:
        | identity                           | page                                                                |
        | the identity of user 15            | the page that the approval request belongs to another user          |
        | a service token                    | the sign-in form                                                    |
        | the identity "nobody@acme.example" | the sign-in form, and core made no account for "nobody@acme.example" |

    Scenario Outline: The gateway is ignored when <case>
      Given agent 9 waits for user 12 to approve the add of "butter" to "Groceries"
      And <change>
      When the access gateway sends the approval link with the identity of user 12
      Then the browser gets the sign-in form

      Examples:
        | case                               | change                                             |
        | the owner is disabled              | the admin disables user 12                         |
        | the instance turns the gateway off | the admin turns the gateway off for "tasks"        |
        | core turns the gateway off         | the admin turns the gateway off for every instance |

    Scenario: The gateway never signs in an account from the sign-up form
      Given the admin lets people sign up with the role "family"
      And user 20 signs up, and gives agent 20 a credential that may read and write
      And agent 20 waits for user 20 to approve the add of "butter" to "Groceries"
      When the access gateway sends the approval link with the identity of user 20
      Then the browser gets the sign-in form

    Scenario: A sign-in on the page wins over the gateway
      Given agent 9 waits for user 12 to approve the add of "butter" to "Groceries"
      And user 12 signed in on the approval page
      When the access gateway sends the approval link with the identity of user 15 to the same browser
      Then the browser gets the approval page, signed in as user 12 on the page itself

    Scenario: The gateway is ignored while it has no configuration
      Given agent 9 waits for user 12 to approve the add of "butter" to "Groceries"
      And the settings of the access gateway are empty
      When the access gateway sends the approval link with the identity of user 12
      Then the browser gets the sign-in form

  Rule: The page runs no script before the decision

    Scenario: The page runs no script before the decision, and only the closing script after it
      Given agent 7 waits for the admin to approve the add of "butter" to "Groceries"
      When the admin approves the add on the approval page
      Then the page ran no script before the decision
      And the page after the decision runs only the script that closes the tab
