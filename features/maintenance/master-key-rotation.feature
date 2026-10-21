@id:master-key-rotation
Feature: Master key rotation
  The operator rotates the master key with a command, while the server is stopped.
  The command encrypts every secret again with the new key, in one step, and signs everyone out.
  A rotation that cannot finish changes nothing.

  Rule: The operator rotates the master key while the server is stopped

    Background:
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"

    @long-running
    Scenario: The command encrypts every secret again and says what it did
      Given the admin has a phone channel with a token
      And the operator stopped the server
      When the operator rotates the master key
      Then the command says that it encrypted 1 instance connection and 1 channel again, and signed everyone out
      And the key file holds a new key, and no half-written key file is left

    @long-running
    Scenario: After a rotation the secrets work, and the admin must sign in again
      Given agent 7 belongs to the admin and may read and write
      When the operator rotates the master key with the server stopped, and starts the server again
      Then agent 7 can read the open tasks "milk", "bread" and "eggs" of "Groceries"
      And the portal asks the admin to sign in again

    @long-running
    Scenario: An authenticator app works after a rotation
      Given user 12 has the role "family"
      And user 12 has an authenticator app
      And the operator rotated the master key with the server stopped, and started the server again
      When user 12 signs in to the portal with their password and the current code
      Then user 12 is in the portal

  Rule: A rotation that cannot finish changes nothing

    @long-running
    Scenario: The command refuses while the server runs
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      When the operator rotates the master key
      Then the command says that the server may be running, and the key file is unchanged

    @long-running
    Scenario: With the master key in the start-up settings, the operator must give the new key
      Given the server runs with a master key in its start-up settings
      And the operator stopped the server
      When the operator rotates the master key
      Then the command asks for the new key in the start-up settings

    @long-running
    Scenario: A wrong current key changes nothing
      Given the server runs with a master key in its start-up settings
      And the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And the operator stopped the server
      When the operator rotates the master key with a wrong current key and a new key
      Then the command says that it cannot decrypt the secrets, and the old key still opens them

  Rule: A lock left by another container is handled with care

    @long-running
    Scenario: A lock of another container stops the rotation
      Given the operator stopped the server
      And the data directory holds the lock of a server in the container "other-container"
      When the operator rotates the master key
      Then the command says that a server may be running on the host "other-container", and the key file is unchanged

    @long-running
    Scenario: The operator forces the rotation past a lock of another container
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And the operator stopped the server
      And the data directory holds the lock of a server in the container "other-container"
      When the operator rotates the master key with force
      Then the command says that it encrypted 1 instance connection and 0 channels again, and signed everyone out

    Scenario: A starting server takes over a lock of another container, with a warning
      Given the operator stopped the server
      And the data directory holds the lock of a server in the container "other-container"
      When the server starts again
      Then the server log warns that it took over the lock of "other-container"
