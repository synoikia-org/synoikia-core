@id:upgrades
Feature: Upgrades
  Core keeps its data in one data file in the data directory.
  Each start brings the data file to the current release, and keeps what was in it.

  Rule: The data file keeps the data across a restart

    Scenario: A restart keeps the users, the roles and the instances
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And the admin made the user "user15@acme.example"
      When core restarts
      Then the admin still has the user "user15@acme.example" with the role "family", and the instance "tasks"
