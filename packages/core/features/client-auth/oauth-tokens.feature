@id:oauth-tokens
Feature: OAuth sign-ins
  After consent, the app exchanges a one-time code for an access token and a refresh token.
  The sign-in of the agent lasts until it expires, or until the person, the admin or the app ends it.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And user 12 has the role "family", which has the instance "tasks"
    And the admin registered the app "Acme Chat"

  Rule: A code is exchanged once, with the right proof

    Scenario: The right proof signs the agent in on the instances of the consent only
      Given Acme Tasks also runs as the instance "shopping"
      And user 12 approved the request of "Acme Chat"
      When "Acme Chat" exchanges the code with the right proof for agent 9
      Then agent 9 gets a session on "tasks", and is told that its sign-in is not for "shopping"

    Scenario: A wrong proof fails and uses up the code
      Given user 12 approved the request of "Acme Chat"
      When "Acme Chat" exchanges the code with a wrong proof, and then with the right one
      Then the token service refuses the code both times

    Scenario: A code used twice ends every sign-in made from it
      Given user 12 approved the request of "Acme Chat"
      And "Acme Chat" exchanged the code for agent 9
      When "Acme Chat" exchanges the same code again
      Then the token service refuses the code with "Authorization code already used"
      And agent 9 is refused, and cannot renew its sign-in

  Rule: A code is short-lived and bound to its return address

    Scenario: A code older than a minute is refused
      Given user 12 approved the request of "Acme Chat"
      And 2 minutes go by
      When "Acme Chat" exchanges the code with the right proof for agent 9
      Then the token service refuses the code with "Authorization code expired"

    Scenario: A code sent with another return address is refused
      Given user 12 approved the request of "Acme Chat"
      When "Acme Chat" exchanges the code with the return address "http://127.0.0.1:9/other"
      Then the token service refuses the code with "redirect_uri does not match"

  Rule: Refresh tokens rotate, and a reused one ends the whole chain

    Scenario: A refresh token used twice ends the sign-in it renewed
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When "Acme Chat" renews the sign-in of agent 9, and then sends the first refresh token again
      Then the token service refuses the first refresh token the second time
      And the renewed access token and refresh token of agent 9 no longer work

    Scenario: A sign-in lasts one hour and can be renewed for 30 days by default
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When 30 days and one minute go by
      Then the token service had said that the access lasts one hour, and the refresh token of agent 9 is refused

    Scenario: The admin sets the lifetimes within their bounds
      When the admin sets the access lifetime to 5 and to 4 minutes, and the refresh lifetime to 365 and to 366 days
      Then the admin is told that 4 minutes and 366 days are out of bounds, and the lifetimes are 5 minutes and 365 days

  Rule: A sign-in belongs to an instance, not to its name

    Scenario: A renamed instance keeps the sign-in, and a new instance with the old name gets none
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When the admin renames "tasks" to "todo" and makes a new instance "tasks"
      Then agent 9 gets a session on "todo", and is told that its sign-in is not for the new "tasks"

    Scenario: Deleting the instance ends a sign-in that covered only that instance
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When the admin deletes the instance "tasks"
      Then the admin sees the sign-in of agent 9 as revoked, and agent 9 cannot renew it

  Rule: A new password and a revocation end sign-ins

    Scenario: A new password of the person ends the sign-in of the agent
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When the admin sets a new password for user 12
      Then agent 9 is refused, and cannot renew its sign-in

    Scenario: The admin revokes the sign-in of an agent
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When the admin revokes the sign-in of agent 9
      Then agent 9 is refused, and cannot renew its sign-in

    Scenario: The app revokes its own refresh token
      Given user 12 let agent 9 in through "Acme Chat" with read and write
      When "Acme Chat" revokes the refresh token of agent 9
      Then agent 9 is refused, and cannot renew its sign-in
