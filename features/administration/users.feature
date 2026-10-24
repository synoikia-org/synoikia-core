@id:users
Feature: Users
  The admin adds the people who use core, each with one role.
  Core never lets administration lock itself out: someone enabled always keeps the Admin role.
  The primary owner is always an enabled admin.
  Disabling a user ends at once everything their agents could reach, and enabling them again brings none of it back.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And user 12 has the role "family", which has the instance "tasks"

  Rule: An admin adds users with a role

    Scenario: User 15 is added with the role "family"
      When the admin adds user 15 with the role "family"
      Then user 15 can sign in to the portal with the role "family"

    Scenario Outline: The name <name> is refused
      When the admin tries to add the user "<name>" with the role "family"
      Then the admin is told that <reason>

      Examples:
        | name                                                              | reason                             |
        | USER12@acme.example                                               | the name is taken                  |
        | x                                                                 | the name breaks the user name rules |
        | user.with.a.name.that.is.much.longer.than.sixty.four.characters.x | the name breaks the user name rules |
        | user 15                                                           | the name breaks the user name rules |

    Scenario: A role that does not exist is refused
      When the admin tries to add the user "user15@acme.example" with the role "guests"
      Then the admin is told that there is no such role

  Rule: Nobody can lock administration out
    The admin who acts is always another enabled admin. Unit tests cover the last active user and the last enabled admin.

    Scenario: The admin cannot disable themselves
      When the admin tries to disable themselves
      Then the admin is told that they cannot disable themselves

  Rule: The primary owner stays an enabled admin
    Unit tests cover the last enabled admin on a server without an owner.

    Scenario: With the admin as the owner, user 12 can leave the Admin role
      Given the admin gave user 12 the Admin role
      When user 12 moves themselves to the role "family"
      Then the next administration request of user 12 is refused, and the admin can still administer core

    Scenario: User 12, a second admin, cannot disable the primary owner
      Given the admin gave user 12 the Admin role
      When user 12 tries to disable the admin
      Then user 12 is told that the primary owner cannot be disabled
      And the admin still signs in to the portal

    Scenario: User 12, a second admin, cannot move the primary owner out of the Admin role
      Given the admin gave user 12 the Admin role
      When user 12 tries to move the admin to the role "family"
      Then user 12 is told that the primary owner keeps the Admin role
      And the admin can still administer core

  Rule: Only the start-up admin changes how the primary owner signs in

    Scenario: User 12, a second admin, cannot set a password for the primary owner
      Given the admin gave user 12 the Admin role
      When user 12 tries to set the password "taken over passphrase" for the admin
      Then user 12 is told that only the start-up admin sets the primary owner's password
      And the admin signs in with their old password, and not with "taken over passphrase"

    Scenario: User 12, a second admin, cannot reset the two-factor sign-in of the primary owner
      Given the admin set up an authenticator app, and gave user 12 the Admin role
      When user 12 tries to reset two-factor for the admin
      Then user 12 is told that only the start-up admin resets the primary owner's two-factor sign-in
      And the admin still needs a code from the app to sign in

  Rule: Disabling a user ends what their agents could reach

    Scenario: Agents 9 and 9b of user 12 stop when user 12 is disabled
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And user 12 let agent 9b in through the app "Acme Chat"
      And user 12 approved the add of "butter" by agent 9 for this session
      When the admin disables user 12
      Then agents 9 and 9b are refused, and the admin sees no session grant on "tasks"

    Scenario: Enabling user 12 again brings nothing back
      Given agent 9 belongs to user 12 and may read and write
      And user 12 let agent 9b in through the app "Acme Chat"
      And the admin disables user 12
      When the admin enables user 12 again
      Then agent 9 is still refused, and agent 9b cannot renew its sign-in
