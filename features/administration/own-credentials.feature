@id:own-credentials
Feature: Own credentials
  Each user makes and revokes the credentials of their own agents in the portal, for the instances of their role.
  They see and revoke only their own credentials and the grants they gave to apps.

  Background:
    Given user 12 has the role "family", which has the instance "tasks"
    And Acme Tasks also runs as the instance "shopping"
    And agent 7 belongs to the admin and may read and write

  Rule: A user manages only their own credentials and grants

    Scenario: User 12 makes a credential only for an instance of their role, and sees only their own
      When user 12 makes a credential for "tasks" and tries one for "shopping"
      Then only the credential for "tasks" is made, and user 12 sees only that credential

    Scenario: User 12 cannot revoke what belongs to others
      Given user 15 has the role "family"
      And user 15 let the app "Acme Chat" use the instance "tasks"
      When user 12 tries to revoke the credential of agent 7 and the grant of user 15
      Then user 12 is told each time that there is no such credential or grant, and both still work
