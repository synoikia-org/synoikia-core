@id:approval-browsers
Feature: Approval browsers
  A browser where a person signed in on the approval page is an approval browser.
  It stays signed in for hours, so the person can decide the next approvals without a new sign-in.
  The person can sign out all their approval browsers in the portal, and the admin can end session grants.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And user 12 has the role "family"

  Rule: A user signs out their approval browsers, and the admin ends session grants

    Scenario: User 12 signs out every approval browser and stays in the portal
      Given user 12 is signed in on an approval page
      When user 12 signs out all their approval browsers in the portal
      Then user 12 saw one approval browser, which must now sign in again, and user 12 is still in the portal

    Scenario: The admin revokes a session grant once
      Given agent 7 belongs to the admin and may read and write
      And the group "tasks" of "tasks" is at level ask
      And the admin approved the add of "butter" by agent 7 for this session
      When the admin revokes the session grant of agent 7 twice
      Then the admin saw the grant of agent 7 on "tasks", and is told the second time that it does not exist

  Rule: An approval browser stays signed in for hours

    Scenario: An approval browser stays signed in for 11 idle hours, but not for 13
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And user 12 signed in on the approval page of a call of agent 9
      When user 12 opens the next approval of agent 9 after 11 idle hours, and the one after that 13 idle hours later
      Then the first approval opens, and the second asks user 12 to sign in

    @long-running
    Scenario: An approval browser that is used every 11 hours stays signed in for 7 days
      Given agent 9 belongs to user 12, whose role "family" may ask for the group "tasks" of "tasks"
      And user 12 signed in on the approval page of a call of agent 9
      When user 12 opens an approval of agent 9 every 11 hours for 8 days
      Then each approval opens until the 7th day ends, and the next one asks user 12 to sign in
