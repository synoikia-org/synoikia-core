@id:portal-sessions
Feature: Portal sessions
  A sign-in opens a session in one browser. The session ends when the person is idle too long, when it gets too old, or when their password or account changes.
  The sign-ins of the portal, the consent page and the approval page are separate, and each one opens only its own pages.

  Background:
    Given user 12 has the role "family"
    And user 15 has the role "family"

  Rule: A session ends after 30 idle minutes

    Scenario: A session is still open after 20 idle minutes
      When user 12 comes back to the portal after 20 idle minutes
      Then user 12 is still signed in

    Scenario: A session ends after 31 idle minutes
      When user 12 comes back to the portal after 31 idle minutes
      Then user 12 must sign in again

  Rule: A session ends after 12 hours, however active it is

    Scenario: User 12 uses the portal all day
      When user 12 uses the portal every 20 minutes for 12 hours
      Then user 12 stays signed in until the 12th hour, and must then sign in again

  Rule: The admin sets the session limits within bounds

    Scenario: Limits out of bounds are refused
      When the admin tries the idle limits 4 and 1441 minutes, and the total limits 0 and 721 hours
      Then the admin is told each time that the limit is out of bounds

    Scenario: The bounds themselves are accepted
      When the admin sets the idle limits 5 and 1440 minutes, and the total limits 1 and 720 hours
      Then the admin sees the idle limit 1440 minutes and the total limit 720 hours

  Rule: Each kind of sign-in opens only its own pages

    Scenario: A sign-in on the consent page does not open the portal
      Given user 12 signed in on the consent page
      When the session of the consent page is taken to the portal
      Then the portal asks for a sign-in

    Scenario: A sign-in on the approval page cannot let an app in
      Given user 12 is signed in on an approval page
      When the session of the approval page is taken to the consent page
      Then the consent page asks for a sign-in

    Scenario: A sign-in on the consent page cannot decide approvals
      Given user 12 signed in on the consent page
      When the session of the consent page is taken to an approval page
      Then the approval page asks for a sign-in

  Rule: A password change ends the other sessions of the person

    Scenario: User 12 changes their password
      Given user 12 is signed in to the portal in a second browser
      And user 12 let the app "Acme Chat" use the instance "tasks"
      When user 12 changes their password in their first browser
      Then only the first browser of user 12 stays signed in
      And the admin sees that the grant of "Acme Chat" for user 12 is revoked

    Scenario: The admin sets a new password for user 15
      Given user 15 is signed in to the portal in a second browser
      When the admin sets a new password for user 15
      Then no browser of user 15 stays signed in

    Scenario: A wrong current password changes nothing
      When user 12 changes their password with a wrong current password
      Then user 12 is told "Current password is incorrect"
      And user 12 still signs in with the old password

  Rule: A disabled user is out at once

    Scenario: The admin disables user 15 while user 15 uses the portal
      When the admin disables user 15
      Then the open portal of user 15 stops working

  Rule: The portal refuses changes that another website sends

    Scenario: A page on another website cannot make a change
      When a page on another website sends a new role "evil" in the browser of the admin
      Then the change is refused as cross-origin, and there is no role "evil"

    Scenario: A change without the anti-forgery token is refused
      When the admin sends a new role "evil" without the anti-forgery token of the portal
      Then the change is refused for a missing token, and there is no role "evil"

    Scenario: The same change from the portal itself works
      When the admin adds the role "chores" in the portal
      Then the admin sees the role "chores"
