@id:roles
Feature: Roles
  A role says which instances its users may reach, with a maximum level for each group and operation.
  On each of its instances, three switches let its users set their own levels, write their own rules and see the status.
  The built-in Admin role has every instance at the instance's own levels, and nobody can change it.

  Background:
    Given user 12 has the role "family", which has the instance "tasks"

  Rule: The Admin role is fixed

    Scenario: Nobody renames or deletes the Admin role
      When the admin tries to rename the Admin role and to delete it
      Then both changes are refused, because the Admin role is fixed

    Scenario: Nobody changes the switches or the maximums of the Admin role
      When the admin tries to change a switch and the maximum of the group "tasks" of the Admin role on "tasks"
      Then both changes are refused, because the Admin role is fixed

  Rule: Each role has its own name

    Scenario: A second role named "family" is refused
      When the admin tries to add the role "family"
      Then the admin is told that a role with that name exists

    Scenario: The role "family" is renamed to "household"
      When the admin renames the role "family" to "household"
      Then user 12 has the role "household" in the portal

  Rule: A role is deleted only when nothing uses it

    Scenario: The role of user 12 is not deleted
      When the admin tries to delete the role "family"
      Then the admin is told that 1 user has the role

    Scenario: The default role for new users is not deleted
      Given the default role for new users is "viewers"
      When the admin tries to delete the role "viewers"
      Then the admin is told that "viewers" is the default role for new users

    Scenario: A role that nobody uses is deleted
      Given the admin adds the role "viewers" in the portal
      When the admin deletes the role "viewers"
      Then the admin sees only the roles "Admin" and "family"

  Rule: A switch change changes only what it names

    Scenario: Turning on own rules keeps own levels as they were
      Given the role "family" lets its users set their own levels on "tasks"
      When the admin turns on own rules for "family" on "tasks"
      Then "family" may set its own levels and write its own rules on "tasks", but not see its status
      And the audit log shows the switch change of "family" on "tasks"

    Scenario: A switch change that is empty or not yes or no is refused
      When the admin sends an empty switch change and then the switch value "yes" for "family" on "tasks"
      Then both changes are refused as not valid

  Rule: Switches belong to the instances of the role

    Scenario: A switch on an instance outside the role is refused
      Given Acme Tasks also runs as the instance "shopping"
      When the admin tries to let "family" see the status of "shopping"
      Then the admin is told to add "shopping" to the role first

    Scenario: A new instance of the role starts with every switch off
      Given the role "family" lets its users set their own levels on "tasks"
      And Acme Tasks also runs as the instance "shopping"
      When the admin gives "family" the instance "shopping" as well
      Then "family" has every switch off on "shopping", and keeps its switches on "tasks"

  Rule: A role maximum never opens more than the instance level

    Scenario: A role maximum write under an instance level ask gives ask to writes and read to reads
      Given the group "lists" of "tasks" is at level ask
      When the admin sets the maximum of "family" for the group "lists" to write
      Then the admin sees that "family" gets ask for "rename a list" and read for "show the open tasks"

    Scenario: A level that does not fit the kind of the operation is refused
      When the admin tries to set the maximum of "family" for "show the open tasks" to write
      Then the admin is told that "show the open tasks" cannot take that level

    Scenario: A maximum on an instance outside the role is refused
      Given Acme Tasks also runs as the instance "shopping"
      When the admin tries to set the maximum of "family" for the group "tasks" of "shopping" to ask
      Then the admin is told to add "shopping" to the role first

  Rule: A new instance and a new group start at none for each role

    Scenario: A new instance of "family" reaches nothing until the admin sets maximums
      Given Acme Tasks also runs as the instance "shopping"
      When the admin gives "family" the instance "shopping" as well
      Then "family" reaches nothing on "shopping"

    Scenario: An instance taken out of the role loses its maximums
      Given the admin sets the maximum of "family" for the group "tasks" to ask
      And the admin takes the instance "tasks" out of the role "family"
      When the admin gives "family" the instance "tasks" again
      Then "family" reaches nothing on "tasks"

    Scenario: A new group after a sync starts at none
      Given the admin sets the maximum of "family" for the group "lists" to read
      And Acme has 2 saved views
      When the admin syncs "tasks"
      Then "family" has the maximum none for the new group "views"

  Rule: Only admins use administration

    Scenario: User 12 is refused everywhere in administration
      When user 12 tries each part of administration
      Then user 12 is refused each time, while their profile and their own instances work
