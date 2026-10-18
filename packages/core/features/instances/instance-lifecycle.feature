@id:instance-lifecycle
Feature: Instance lifecycle
  The admin adds an instance of a plugin, changes its connection, turns it on and off, and tests a connection.
  Core keeps the secrets of the connection encrypted, and gives them only to the plugin of the instance.

  Rule: A new instance stores its secrets encrypted and starts at once

    Scenario: A new instance with the API token is ready, and the token is kept encrypted
      When the admin enables Acme Tasks and adds the instance "tasks"
      Then "tasks" is ready, and its connection shows the API token as set, ending in "7d6c"
      And the data directory does not hold the API token as plain text

    Scenario: The audit log names the secret of a new instance, but not its value
      When the admin enables Acme Tasks and adds the instance "tasks"
      Then the audit log shows that the admin added "tasks" with the secret "token", and not its value

  Rule: An instance needs a free valid name and a valid connection

    Scenario: A reserved name and a name with capitals and spaces are refused
      When the admin tries to add the instances "api" and "Bad Slug"
      Then the admin is told both times that the name is not valid

    Scenario: A name that another instance uses is refused
      Given Acme Tasks runs as the instance "tasks"
      When the admin tries to add another instance "tasks"
      Then the admin is told that "tasks" is already in use

    Scenario: A connection without the address of Acme and an unknown plugin are refused
      When the admin tries to add "tasks" without the address of Acme, and "notes" with the plugin "notes"
      Then the admin is told that the connection is not valid, and that there is no plugin "notes"

  Rule: Connection edits keep each secret unless replaced or cleared

    Scenario: A new secret keeps the token, and the plugin starts again with both
      Given the plugin of "tasks" tells Acme what it can reach when it starts
      And Acme Tasks runs as the instance "tasks"
      When the admin sets the webhook secret of "tasks" to "hook-5e3cret-77"
      Then Acme hears that the plugin started again with the secrets "token" and "webhookSecret"

    Scenario: Clearing the webhook secret keeps the token
      Given the instance "tasks" has the webhook secret "hook-5e3cret-77"
      When the admin clears the webhook secret of "tasks"
      Then the admin sees that the webhook secret is not set, and that the API token still ends in "7d6c"

    Scenario: A secret that Acme Tasks does not declare is refused
      Given Acme Tasks runs as the instance "tasks"
      When the admin tries to save the connection of "tasks" with the secret "password"
      Then the admin is told that "password" is not a secret of Acme Tasks

  Rule: Switches start and stop the instance

    Scenario: A disabled instance is stopped, and agents are told that it is unavailable
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the admin disabled the instance "tasks"
      When agent 7 asks for the open tasks of "Groceries"
      Then the admin sees that "tasks" is stopped, and agent 7 is told that "tasks" is unavailable

    Scenario: An instance that the admin enables again is ready
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the admin disabled the instance "tasks"
      When the admin enables the instance "tasks"
      Then agent 7 can read the open tasks "milk", "bread" and "eggs" of "Groceries"

    Scenario: Disabling Acme Tasks stops its instance
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the admin disabled Acme Tasks
      When agent 7 asks for the open tasks of "Groceries"
      Then the admin sees that "tasks" is stopped, and agent 7 is told that "tasks" is unavailable

  Rule: A connection test runs apart from the live instance

    Scenario: A candidate address that does not answer fails its test, and the live instance stays ready
      Given Acme Tasks runs as the instance "tasks", and its plugin checks Acme when it starts
      When the admin tests "tasks" with the address "http://127.0.0.1:9"
      Then the admin is told that the test cannot reach Acme, and "tasks" is still ready

    Scenario: Connection tests use the budget of their address, as sign-ins do
      Given Acme Tasks runs as the instance "tasks"
      And someone tried to sign in 59 times from the address "203.0.113.7", and the admin tested "tasks" once from there
      When the admin tests the connection of "tasks" again from the address "203.0.113.7"
      Then the admin is told that there were too many attempts

  Rule: Connection checks follow the current plugin version

    Scenario: A newer version that keeps the schema id but adds a field checks the new field
      Given the connection schema of Acme Tasks has the id "https://acme.example/connection"
      And Acme Tasks runs as the instance "tasks"
      And Acme Tasks 1.1.0 keeps that id, and also requires the field "workspace"
      When the admin saves the connection of "tasks" without a workspace
      Then the admin is told that the connection is not valid, because "workspace" is missing
