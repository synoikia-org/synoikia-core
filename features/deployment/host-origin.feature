@id:host-origin
Feature: Host names and origins of agents
  A web page in a browser must not reach core through a name that core does not know.
  So the agent port lets in only known host names, and refuses requests from pages of other sites.

  Background:
    Given Acme Tasks runs as the instance "tasks"
    And agent 7 belongs to the admin and may read and write

  Rule: Agents must come by a known name and origin

    Scenario: A request for the host name "attacker.example" is refused
      When agent 7 opens a session on "tasks" through the host name "attacker.example"
      Then agent 7 is refused because the host name or the origin is not allowed

    Scenario: A request from a page of another site is refused
      When agent 7 opens a session on "tasks" from a page of "http://attacker.example"
      Then agent 7 is refused because the host name or the origin is not allowed

    Scenario: The local name, an address, a listed name and the public address are let in
      Given the operator lists the host name "mcp.lan" and sets the public address "https://tasks.acme.example"
      When agent 7 opens a session on "tasks" through "localhost", "127.0.0.1", "mcp.lan:8080" and "tasks.acme.example"
      Then agent 7 gets a session each time
