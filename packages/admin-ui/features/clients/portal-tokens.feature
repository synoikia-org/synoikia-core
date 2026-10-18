@id:portal-tokens
Feature: Bearer tokens in the portal
  The admin makes bearer tokens for MCP clients on the clients page.
  A new token shows once. A revoke asks first. A list that fails to load shows no rows.

  Rule: A new token shows once, and a revoke asks first

    Scenario: A new token for /tasks shows once
      Given the instance /tasks
      When the admin makes the bearer token "laptop" for /tasks
      Then the portal shows the new token once, with "Copy this now. It is not shown again."
      And the clients page lists "laptop" without its value

    Scenario: A token expiry in the past is refused in the dialog
      When the admin makes the bearer token "laptop" for all instances, which expired yesterday
      Then the token dialog shows the alert "Expiry must be in the future"

    Scenario: A token is revoked only after the admin confirms
      Given the admin has the bearer token "laptop"
      When the admin revokes "laptop" and confirms the question
      Then the question said "Clients using it lose access immediately."
      And the clients page no longer lists "laptop"

  Rule: A failed list shows no rows

    @backlog
    Scenario: The tokens stay hidden while the owners fail to load
      Given the admin has the bearer token "laptop"
      And the server cannot read its users
      When the admin opens the clients page
      Then the portal shows why, and lists no token
