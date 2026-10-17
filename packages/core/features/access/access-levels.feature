@id:access-levels
Feature: Access levels
  An admin decides how far each agent can go with each group of operations.

  Background:
    Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
    And agent 7 belongs to the admin

  Rule: The level of a group decides whether an agent can read

    Scenario: An agent reads a list in a group at level read
      Given the admin sets the group "lists" of "tasks" to read
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 gets "milk", "bread" and "eggs"

    Scenario: An agent cannot read a list in a group at level none
      Given the admin sets the group "lists" of "tasks" to none
      When agent 7 asks for the open tasks of "Groceries"
      Then agent 7 is told that the admin turned the operation off, and gets no tasks

    Scenario: A change of level applies to the next call
      Given the group "lists" of "tasks" is at level none
      And agent 7 has an open session on "tasks"
      When the admin sets the group "lists" to read
      And agent 7 asks again for the open tasks of "Groceries" in the same session
      Then agent 7 gets "milk", "bread" and "eggs"
