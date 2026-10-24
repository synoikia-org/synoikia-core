@id:portal-host-names
Feature: Host names of the portal
  A web page of another site can give its own name the address of the server.
  So the portal port lets in only known host names, and a page of another site cannot make the first account.

  Rule: The portal lets in only known host names

    Scenario: A page that comes by the host name "attacker.example" cannot make the first account
      Given a new server with no accounts
      When someone makes the first account "intruder" through the host name "attacker.example"
      Then they are refused because the host name is not allowed
      And the server still has no accounts

    Scenario: The portal lets in the local name, an address, a listed name and its public address
      Given the operator lists the host name "synoikia.lan" for the portal and sets the public portal address "https://admin.acme.example"
      When the admin opens the portal through "localhost", "127.0.0.1", "synoikia.lan:3001" and "admin.acme.example"
      Then the portal answers each time
