@id:portal-roles
Feature: Roles in the portal
  The admin gives each role its instances and three switches on each of them.
  The switches let the role's users set personal levels, keep own rules and see the status of the instance.
  The most a role may do in each group is set on the access page of the instance.
  Adding an instance and turning a switch apply at once. The removal of an instance, a rename and a delete ask first.
  When core refuses a change, the portal says why.

  Rule: Adding an instance and turning a switch apply at once

    Scenario: Adding /tasks to "family" and turning on personal levels asks nothing
      Given the role "family" and the instance /tasks
      When the admin adds /tasks to "family" and turns on "Set personal levels" on the roles page
      Then "family" has /tasks with personal levels, and the portal asked nothing

    Scenario: A switch on an instance that the role lost meanwhile is explained
      Given the role "family" has the instance /tasks
      And the admin opened the roles page, and another admin removed /tasks from "family" meanwhile
      When the admin turns on "Own pre-approval rules" for "family" on /tasks
      Then the portal says to add the instance to the role first

  Rule: Removing an instance from a role asks first, because the role loses its levels there

    Scenario: Removing /tasks from "family" names what the role loses
      Given the role "family" has the instance /tasks
      When the admin removes /tasks from "family" on the roles page and confirms the question
      Then the question said that "family" loses its maximum levels, personal levels and own rules on /tasks
      And "family" no longer has /tasks

    Scenario: A cancelled removal keeps /tasks and its levels
      Given the role "family" has the instance /tasks
      And "family" may at most Read in the group "lists" of /tasks
      When the admin removes /tasks from "family" on the roles page and cancels the question
      Then "family" still has /tasks, and still may at most Read in the group "lists"

  Rule: A role's maximum levels are set on the access page of the instance

    Scenario: The admin lets "family" at most Read in the group "lists" of /tasks
      Given the role "family" has the instance /tasks
      When the admin follows the levels of "family" on /tasks and sets the group "lists" to Read
      Then "family" now may at most Read in the group "lists" of /tasks

    Scenario: Setting all groups for "family" asks once
      Given the role "family" has the instance /tasks
      When the admin sets all groups of "family" on /tasks to Read and confirms the question
      Then "family" now may at most Read in every group of /tasks

  Rule: A rename or a delete asks first

    Scenario: A new name is trimmed and saved
      Given the role "family"
      When the admin renames "family" to " household " on the roles page
      Then the roles page shows the role "household"

    Scenario Outline: A rename that is cancelled or unchanged keeps the name
      Given the role "family"
      When the admin renames "family" on the roles page and <answers>
      Then the role "family" keeps its name, and nothing was saved

      Examples:
        | answers                  |
        | cancels the question     |
        | keeps the name as it is  |

    Scenario: A role is deleted only after the admin confirms
      Given the role "family"
      When the admin deletes "family" on the roles page and confirms the question
      Then the question said "Delete the role family?"
      And the roles page no longer shows "family"

  Rule: The roles page says why core refuses a change

    Scenario: A name that another role has is refused
      Given the role "family"
      When the admin adds the role "family" on the roles page
      Then the portal shows the alert "A role with that name exists"

    Scenario: A role that a user has cannot be deleted
      Given user 12 has the role "family"
      When the admin deletes "family" on the roles page and confirms the question
      Then the portal says that 1 user has the role, who must move to another role first
