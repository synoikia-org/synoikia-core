@id:secrets
Feature: Secrets
  Core keeps the secrets of instances and notification channels encrypted with its master key.
  The master key comes from the start-up settings, or from a private key file in the data directory.
  Administration shows only whether a secret is set, and never its value.

  Rule: A secret is encrypted with the master key

    Scenario: The API token works after a restart and is not kept as plain text
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      When core restarts
      Then agent 7 can read the open tasks "milk", "bread" and "eggs" of "Groceries"
      And the data directory does not hold the API token as plain text

    Scenario: Core that starts with another master key cannot read the API token
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      When the operator restarts the server with another master key
      Then the admin signs in again and sees that "tasks" cannot read its secrets

    Scenario: After a restart with another master key, the admin enters the API token again
      Given Acme Tasks runs as the instance "tasks"
      And the operator restarts the server with another master key
      When the admin opens the connection of "tasks" and then saves it with the API token
      Then the admin was told first to enter the secrets again, and then "tasks" runs with the API token set

  Rule: The master key in the start-up settings has 32 bytes

    Scenario: A master key in the start-up settings is used, and no key file is made
      When a new server starts with a master key in its start-up settings
      Then the data directory holds no key file
      And the server log does not warn about the master key

    Scenario: A master key of 16 bytes stops the start
      When the operator restarts the server with a master key of 16 bytes
      Then the server does not start, because the master key must be 32 bytes

  Rule: Without a master key in the start-up settings, core keeps a private key file

    Scenario: The first start makes a key file that only its owner can read, and warns
      When a new server starts without a master key
      Then the data directory holds a key file that only its owner can read
      And the server log warns that the master key is in the data directory

    Scenario: A damaged key file stops the start and is kept as it is
      Given the key file of the server holds "damaged"
      When core restarts and fails
      Then the server does not start, because the key file must hold 32 bytes
      And the key file still holds "damaged"

  Rule: Administration never shows a secret

    Scenario: The admin sees that the API token is set, and only its last characters
      Given Acme Tasks runs as the instance "tasks"
      When the admin opens the connection of "tasks"
      Then the admin sees that the API token is set and ends in "7d6c"
      And the connection never shows the API token

    Scenario: A save without the token keeps it, and clearing the token empties it
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 belongs to the admin and may read and write
      And the admin saves the connection of "tasks" without the token
      When the admin clears the token of "tasks"
      Then the admin sees that the API token is not set, and Acme refuses agent 7

    Scenario: A connection that moves to another server needs the token again
      Given Acme Tasks runs as the instance "tasks"
      When the admin tests and saves "tasks" with the address "https://other.example" and no token
      Then the admin is told both times to enter the token again
      And the test with the address "https://other.example" and a new token works
