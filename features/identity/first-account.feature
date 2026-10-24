@id:first-account
Feature: First account
  A new server has no accounts. The first person who opens the portal makes the first account, with the Admin role.
  The first account is the primary owner. A server without a browser can get its first admin from its start-up settings instead.
  The start-up settings are also the way back in for the owner.

  Rule: The first account is made once

    Scenario: The admin makes the first account on a new server
      Given a new server with no accounts
      When the admin makes the first account "admin" with the password "correct horse battery"
      Then the admin is signed in to the portal as "admin"

    Scenario: Nobody can make the first account again
      When someone makes the first account "intruder" with the password "correct horse battery"
      Then they are told that setup is already done
      And the server has no account "intruder"

    Scenario: Two people make the first account at the same moment
      Given a new server with no accounts
      When "operator" and "intruder" each make the first account at the same moment
      Then one of them has the only account, and the other is told that setup is already done

  Rule: The first account is the primary owner

    Scenario: The first account is the primary owner on the user list
      Given a new server with no accounts
      When the admin makes the first account "admin" with the password "correct horse battery"
      Then the user list marks "admin" as the primary owner

  Rule: A password has 12 to 1024 characters

    Scenario: A short password is refused
      Given a new server with no accounts
      When the admin makes the first account "admin" with the password "short"
      Then the admin is told that a password needs at least 12 characters
      And the server still has no accounts

    Scenario: A password over 1024 characters is refused
      Given a new server with no accounts
      When the admin makes the first account "admin" with a password of 1025 characters
      Then the admin is told that the password is too long
      And the server still has no accounts

  Rule: A server without a browser gets its first admin from its start-up settings

    @long-running
    Scenario: The start-up settings make the first admin on an empty server
      Given the operator sets the start-up admin "admin" with the password "correct horse battery"
      When the server starts on an empty data directory
      Then the server log says that it made the admin "admin"
      And "admin" signs in to the portal with the password "correct horse battery"

    @long-running
    Scenario: An empty server without a start-up admin asks for the portal
      When the server starts on an empty data directory without a start-up admin
      Then the server log says to open the portal to make the first account

  Rule: The start-up admin is the owner's way back in

    @long-running
    Scenario: A start with the start-up admin gives the owner the new password
      Given the server started once and made the admin "admin" with the password "correct horse battery"
      When the server starts again with the start-up admin "admin" and the password "new horse battery staple"
      Then "admin" signs in with "new horse battery staple", and not with "correct horse battery"

    @long-running
    Scenario: A start with another name renames the owner
      Given the server started once and made the admin "admin" with the password "correct horse battery"
      When the server starts again with the start-up admin "owner" and the password "correct horse battery"
      Then "owner" signs in to the portal, and the server has no account "admin"

    @long-running
    Scenario: A name that another account has stops the start
      Given the server started once and made the admin "admin", and the admin made the account "admin2"
      When the server starts again with the start-up admin "admin2"
      Then the server does not start, and its log says that "admin2" belongs to another account

    @long-running
    Scenario: A start with the two-factor reset lets the owner in with the password alone
      Given the server started once and made the admin "admin", who set up an authenticator app
      When the server starts again with the start-up admin "admin" and the two-factor reset
      Then "admin" signs in to the portal with the password alone
