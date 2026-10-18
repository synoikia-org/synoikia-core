@id:user-deletion
Feature: User deletion
  The admin can delete a user for good.
  The delete first takes away every credential of the user and ends their waiting approvals.
  It then removes what only the user had, and keeps shared records and the history in the audit log.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And user 15 has the role "family", which has the instance "tasks"

  Rule: Some deletes are refused

    Scenario: The admin cannot delete themselves
      When the admin tries to delete themselves
      Then the admin is told that they cannot delete themselves

    @backlog
    Scenario: The last user and the last enabled admin are not deleted
      Given user 15 is disabled
      When the admin tries to delete the last enabled admin
      Then the admin is told that the last enabled admin stays

    Scenario: A user who does not exist is not found
      When the admin tries to delete a user who does not exist
      Then the admin is told that there is no such user

  Rule: A delete first takes every credential away

    Scenario: Deleting user 15 ends their portal, their credentials and their approvals
      Given agent 15 belongs to user 15, whose role "family" may ask for the group "tasks" of "tasks"
      And agent 15 waits for user 15 to approve the add of "butter" to "Groceries"
      When the admin deletes user 15
      Then the open portal of user 15 stops working
      And agent 15 is refused, because its credential was revoked when user 15 was deleted, and the add of "butter" was denied

    @backlog
    Scenario: An approval that still waits for user 15 stops the delete
      Given agent 15 belongs to user 15, whose role "family" may ask for the group "tasks" of "tasks"
      And agent 15 waits for user 15 to approve the add of "butter" to "Groceries"
      When user 15 is deleted while the approval still waits
      Then the delete is refused, because approvals are pending

    @backlog
    Scenario: The audit log says why the waiting add of agent 15 ended
      Given agent 15 belongs to user 15, whose role "family" may ask for the group "tasks" of "tasks"
      And agent 15 waits for user 15 to approve the add of "butter" to "Groceries"
      When the admin deletes user 15
      Then the audit log shows that the add of "butter" was cancelled because user 15 was deleted

  Rule: A delete removes what only the user had, and keeps shared records

    Scenario: The own rules of user 15 go with them
      Given the role "family" lets its users write their own rules on "tasks"
      And the admin sets the maximum of "family" for the group "tasks" to ask
      And user 15 pre-approves adding any task to "Groceries"
      When the admin deletes user 15
      Then the admin sees no rule on "tasks"

    Scenario: A rule that user 15 wrote as an admin stays, without its author
      Given the admin gave user 15 the Admin role
      And user 15 pre-approves adding any task to "Groceries" for every user
      When the admin deletes user 15
      Then the admin sees the rule for adding tasks to "Groceries", with no author

    Scenario: A new user with the same name gets nothing of the old one
      Given agent 15 belongs to user 15, whose role "family" may ask for the group "tasks" of "tasks"
      And user 15 approved the add of "butter" by agent 15 for this session
      And the admin deletes user 15
      When the admin adds user 15 with the role "family"
      Then the new user 15 has no session grant on "tasks", and the audit log keeps the two users 15 apart

  Rule: The audit log keeps the name of a deleted user

    Scenario: The audit log shows the delete, and the earlier events keep the name
      Given agent 15 belongs to user 15 and may read and write
      When the admin deletes user 15
      Then the audit log shows that the admin deleted user 15
      And the earlier events of user 15 show the name "user15@acme.example", marked as deleted

    Scenario: The filter and the export find a deleted user by name in any case
      Given agent 15 belongs to user 15 and may read and write
      And the admin deletes user 15
      When the admin filters the audit log by "USER15@ACME.EXAMPLE" and exports it
      Then both times the admin finds the sign-in and the new credential of "user15@acme.example"
