@id:local-sign-in-off
Feature: Password sign-in off
  The admin can turn off sign-in with a password, so that people sign in only with single sign-on.
  The primary owner always keeps the password sign-in, so the server always has a way in.

  Rule: Password sign-in off leaves a password only to the primary owner

    Scenario: Without single sign-on, the admin turns password sign-in off and still signs in with a password
      Given the admin turned off password sign-in, with no single sign-on set up
      When the admin signs in to the portal with their password
      Then the admin is in the portal

    Scenario: User 15 is told to use single sign-on
      Given user 15 has a local account with the role "family"
      And password sign-in is off
      When user 15 signs in to the portal with their password
      Then user 15 is told "Use single sign-on" in the portal and on the consent page
