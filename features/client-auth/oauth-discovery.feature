@id:oauth-discovery
Feature: OAuth discovery
  An agent's app finds out how to sign in with OAuth from the descriptions that the server publishes.
  The server publishes them only under its public address, never under a name that a caller sends.

  Rule: OAuth needs the public address

    Scenario: Without a public address, OAuth is unavailable
      Given Acme Tasks runs as the instance "tasks"
      When an agent's app looks for OAuth on a server without a public address, also under a forged host name
      Then the app is told each time that OAuth is temporarily unavailable, and that it may not register
      And "tasks" asks the app to sign in with no pointer to OAuth

    @long-running
    Scenario: A server that starts without a public address says that OAuth is off
      When the server starts on an empty data directory without a start-up admin
      Then the server log warns that OAuth is off until the public address is set, and that credentials still work

  Rule: The server describes itself for OAuth agents

    Scenario: The description of the server names its address, the proof method and the registration
      Given the server has a public address for agents
      When an agent's app reads the OAuth description of the server
      Then it names the public address, the proof method S256 and the registration of apps

    Scenario: The description of an instance names its address, not its display name
      Given the server has a public address for agents
      And the instance "tasks" has the display name "Family to-dos"
      When an agent's app reads the OAuth description of "tasks"
      Then it names the address of "tasks" and the server, but not "Family to-dos"

    Scenario: An instance without OAuth has no description
      Given the server has a public address for agents
      And the admin lets "shopping" take only credentials
      When an agent's app reads the OAuth description of "shopping"
      Then the app finds no OAuth description of "shopping"
