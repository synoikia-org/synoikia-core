@id:portal-sign-in
Feature: Portal sign-in
  A person signs in to the portal with a user name and a password, and with a code when they set up an authenticator app.
  Core locks a name after five failures and limits the attempts from one address, so nobody can guess a password.

  Background:
    Given user 12 has the role "family"
    And user 15 has the role "family"

  Rule: A person signs in with a name and a password

    Scenario: User 12 signs in, and must sign in again after signing out
      When user 12 signs in to the portal with their password
      Then user 12 is in the portal
      And after a sign-out, user 12 must sign in again

    Scenario: A wrong password is refused
      When user 12 signs in to the portal with the password "not my passphrase"
      Then the sign-in is refused with "Invalid username or password"

    Scenario: An unknown name gets the same answer
      When someone signs in to the portal as "ghost" with the password "not my passphrase"
      Then the sign-in is refused with "Invalid username or password"

  Rule: Five failures lock a name for 15 minutes

    Scenario: Five wrong passwords lock the name
      Given user 12 gave a wrong password 5 times
      When user 12 signs in to the portal with their password
      Then the sign-in is refused with "try again in 15 min"

    Scenario: A name counts as one name in any case
      Given someone gave a wrong password as "Admin" 3 times and as "ADMIN" 2 times
      When the admin signs in to the portal with their password
      Then the sign-in is refused with "try again in 15 min"

  Rule: A name stays free after four failures, and is free again 15 minutes after a lock

    Scenario: Four failures do not lock the name
      Given user 12 gave a wrong password 4 times
      When user 12 signs in to the portal with their password
      Then user 12 is in the portal

    Scenario: The lock ends after 15 minutes
      Given user 12 gave a wrong password 5 times
      And 15 minutes go by
      When user 12 signs in to the portal with their password
      Then user 12 is in the portal

  Rule: The lock starts at the fifth failure

    Scenario: Failures spread over 14 minutes lock the name for 15 minutes from the fifth
      Given user 12 gave a wrong password once, and 4 times more 14 minutes later
      And 10 minutes go by
      When user 12 signs in to the portal with their password
      Then the sign-in is refused with "try again in 5 min"

  Rule: Failures on the sign-in of the consent page lock only that page

    Scenario: Five failures on the consent page leave the portal open
      Given someone gave a wrong password as "admin" 5 times on the consent page
      When the admin signs in to the portal with their password
      Then the admin is in the portal

    Scenario: The consent page then asks to try again later
      Given someone gave a wrong password as "admin" 5 times on the consent page
      When the admin signs in on the consent page with their password
      Then the sign-in is refused with "Too many attempts"

  Rule: One address has a budget of 60 attempts in 5 minutes

    Scenario: The 61st attempt from one address is refused
      Given people sign in from the address "203.0.113.7"
      And someone tried to sign in 60 times
      When user 12 signs in to the portal with their password
      Then the sign-in is refused with "Too many attempts"

    Scenario: The budget also covers sign-up, client registration, the consent page and the connection test
      Given people sign in from the address "203.0.113.7"
      And someone tried to sign in 60 times
      When sign-up, client registration, the consent page and the connection test are each tried
      Then each one is refused as too many attempts

    Scenario: The code step counts toward the budget too
      Given user 12 has an authenticator app
      And people sign in from the address "203.0.113.7"
      And user 12 gave their password in the portal, and someone then tried to sign in 60 times
      When user 12 gives the current code
      Then the sign-in is refused with "Too many attempts"

  Rule: Failures are in the audit log, and a lock is announced once

    Scenario: A failed sign-in is in the audit log with the name and the address
      Given people sign in from the address "203.0.113.7"
      When user 15 signs in to the portal with the password "not my passphrase"
      Then the audit log shows a failed sign-in of user 15 from "203.0.113.7"

    Scenario: The fifth failure is audited as a lock and announced once
      Given the admin gets a notification when a sign-in is locked
      And user 15 gave a wrong password 4 times
      When user 15 gives a wrong password twice more
      Then the audit log shows that the fifth failure locked user 15
      And the admin got one notification "Sign-in locked"

    Scenario: A wrong code on the consent page is in the audit log
      Given user 12 has an authenticator app
      And user 12 gave their password on the consent page
      When user 12 gives a wrong code on the consent page
      Then the audit log shows a failed code of user 12

  Rule: A person with an authenticator app gives a code after the password

    Scenario: A current code signs user 12 in
      Given user 12 has an authenticator app
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives the current code
      Then user 12 is in the portal

    Scenario: The code that confirmed the app is refused
      Given user 12 has an authenticator app
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives the code that confirmed the app
      Then the sign-in is refused with "Invalid code"

    Scenario: A code from 30 seconds ago still works
      Given user 12 set up an authenticator app 2 minutes ago
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives the code from 30 seconds ago
      Then user 12 is in the portal

  Rule: A code that is old, used or not a number is refused

    Scenario: A code from a minute ago is refused
      Given user 12 set up an authenticator app 2 minutes ago
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives the code from a minute ago
      Then the sign-in is refused with "Invalid code"

    Scenario: A code that already signed user 12 in is refused
      Given user 12 has an authenticator app
      And user 12 signed in with the current code in another browser
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives the same code again
      Then the sign-in is refused with "Invalid code"

    Scenario: Letters are refused
      Given user 12 has an authenticator app
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives the code "abcdef"
      Then the sign-in is refused with "Invalid code"

  Rule: The code step has a time limit and counts failures

    Scenario: A code more than 5 minutes after the password is refused
      Given user 12 has an authenticator app
      And user 12 gave their password in the portal and was asked for a code
      And 6 minutes go by
      When user 12 gives the current code
      Then the sign-in is refused with "Sign in again"

    Scenario: Wrong codes count toward the lock
      Given user 12 has an authenticator app
      And user 12 gave their password and then a wrong code 5 times
      When user 12 signs in to the portal with their password
      Then the sign-in is refused with "try again in 15 min"

  Rule: Each recovery code replaces the app once

    Scenario: A recovery code signs user 12 in once
      Given user 12 has an authenticator app and 10 recovery codes
      And user 12 gave their password in the portal and was asked for a code
      When user 12 gives their first recovery code
      Then user 12 is in the portal, and the first recovery code does not work again
      And the audit log shows that user 12 used a recovery code, with 9 left

  Rule: A current code from the app replaces all recovery codes

    Scenario: User 12 gets new recovery codes, and the old ones stop working
      Given user 12 has an authenticator app and 10 recovery codes
      When user 12 asks for new recovery codes with the current code
      Then user 12 gets 10 new recovery codes, with 10 left, and only the new ones sign in
      And the audit log shows that user 12 replaced their recovery codes

    Scenario Outline: <what> does not replace the recovery codes
      Given user 12 has an authenticator app and 10 recovery codes
      When user 12 asks for new recovery codes with <code>
      Then user 12 is told "Invalid code", and the first recovery code still signs user 12 in

      Examples:
        | what                            | code                            |
        | A recovery code                 | their first recovery code       |
        | A wrong code                    | a wrong code                    |
        | The code that confirmed the app | the code that confirmed the app |

    Scenario: Without an authenticator app there are no recovery codes to replace
      When user 12 asks for new recovery codes with the code "123456"
      Then user 12 is told "Two-factor authentication is off"

  Rule: A person sets up an authenticator app in their profile

    Scenario: User 12 sets up an authenticator app
      When user 12 sets up an authenticator app and confirms it with a current code
      Then the app shows the account "Synoikia:user12@acme.example"
      And two-factor sign-in is on for user 12
      And the data directory does not hold the secret of the app as plain text

    Scenario: A wrong code does not confirm the app
      When user 12 sets up an authenticator app and confirms it with a wrong code
      Then user 12 is told "That code is not valid"
      And two-factor sign-in is off for user 12

    Scenario: A second app needs a reset first
      Given user 12 has an authenticator app
      When user 12 starts to set up another authenticator app
      Then user 12 is told "reset it first"

  Rule: A new authenticator app signs out the approval browsers of its user

    Scenario: Setting up an app signs out the approval browser of user 12
      Given user 12 is signed in on an approval page
      When user 12 sets up an authenticator app and confirms it with a current code
      Then the approval browser of user 12 must sign in again

  Rule: The admin can require two-factor sign-in for everyone

    Scenario: User 15 must set up an app before anything else
      Given the admin requires two-factor sign-in for everyone
      When user 15 signs in to the portal with their password
      Then user 15 must set up an authenticator app before anything else

    Scenario: User 12 cannot turn off their app while it is required
      Given user 12 has an authenticator app
      And the admin requires two-factor sign-in for everyone
      When user 12 turns off their authenticator app with the current code
      Then user 12 is told "Two-factor authentication is required on this server"

    Scenario: Turning off the app needs a valid code
      Given user 12 has an authenticator app
      When user 12 turns off their authenticator app with a wrong code
      Then user 12 is told "Invalid code"
      And two-factor sign-in is on for user 12

  Rule: The admin can reset the authenticator app of a user

    Scenario: The admin resets the app of user 12
      Given user 12 has an authenticator app
      And user 12 is signed in on an approval page
      When the admin resets the authenticator app of user 12
      Then user 12 signs in with the password alone, and the approval browser must sign in again
      And the audit log shows that the admin reset the authenticator app of user 12
