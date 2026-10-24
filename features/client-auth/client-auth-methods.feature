@id:client-auth-methods
Feature: Agent sign-in methods
  An agent signs in to an instance with a credential, with OAuth or through the access gateway.
  The admin turns each method on for the whole server. An instance can only narrow that choice.

  Rule: At least one agent sign-in method is on

    Scenario: A new server takes credentials and OAuth, but not the access gateway
      When the admin reads the agent sign-in methods
      Then credentials and OAuth are on, and the access gateway is off

    Scenario: The admin cannot turn every method off
      When the admin tries to turn off credentials and OAuth
      Then the admin is told that at least one sign-in method must stay on

    Scenario: The access gateway needs its team and its application
      When the admin tries to turn on the access gateway without its team, to pick an unknown provider, and to clear the team
      Then the admin is told each time that the access gateway is not set up

  Rule: A partial save keeps what it leaves out

    Scenario: Turning credentials off keeps OAuth and the access gateway
      Given the access gateway signs people in for core
      When the admin turns off only credentials
      Then OAuth and the access gateway stay on, with the team and application of the access gateway

    Scenario: Sign-in options of release 0.10 are refused
      When the admin saves the sign-in options "defaultAuthMode" and "trustedIdentityHeader" of release 0.10
      Then the admin is told that "defaultAuthMode" and "trustedIdentityHeader" are no longer supported

  Rule: The admin narrows the methods of an instance

    Scenario: The methods of an instance are kept once each
      Given Acme Tasks runs as the instance "tasks"
      When the admin lets "tasks" take OAuth, credentials and OAuth again
      Then "tasks" takes credentials and OAuth

    Scenario: An unknown method is refused
      Given Acme Tasks runs as the instance "tasks"
      When the admin tries to let "tasks" take "telepathy"
      Then the admin is told that "telepathy" is not a sign-in method

    Scenario: An instance takes only the methods that are on for the server
      Given the admin lets "tasks" take credentials and OAuth
      When the admin turns off only credentials
      Then "tasks" takes only OAuth

  Rule: An instance refuses the methods it does not take

    Scenario: An instance that takes only OAuth refuses a credential
      Given agent 7 belongs to the admin and may read and write
      And Acme Tasks also runs as the instance "shopping"
      And the admin lets "shopping" take only OAuth
      When agent 7 opens a session on "shopping" with its credential
      Then agent 7 is told that "shopping" does not take its kind of credential

    Scenario: An instance with no method left tells only a live credential why
      Given agent 7 belongs to the admin and may read and write
      And the admin lets "tasks" take only the access gateway, which is off for the server
      When agent 7 and a stranger each open a session on "tasks"
      Then agent 7 is told that "tasks" accepts no sign-in method
      And the stranger is asked to sign in, as at an instance that does not exist

  Rule: A credential comes first, then the access gateway, then the pointer to OAuth

    Scenario: An instance with the access gateway and credentials lets both in
      Given user 12 has the role "family", which has the instance "tasks"
      And agent 7 belongs to the admin and may read and write
      And the access gateway signs people in for core
      When agent 7 opens a session on "tasks" with its credential, and user 12 through the access gateway
      Then both get a session on "tasks"

    Scenario: A caller with neither is pointed to OAuth
      Given the server has a public address for agents
      And the access gateway signs people in for core
      When a stranger opens a session on "tasks" with no credential and no gateway identity
      Then the stranger is asked to sign in, and pointed to the OAuth description of "tasks"

  Rule: Strangers learn nothing about which instances exist

    Scenario: A stranger is asked to sign in everywhere
      Given Acme Tasks also runs as the instance "shopping"
      And the admin disabled the instance "shopping"
      When a stranger opens a session on "tasks", on "shopping" and on "nope"
      Then the stranger gets the same request to sign in each time

    Scenario: A live credential learns which instances exist
      Given agent 7 belongs to the admin and may read and write
      And Acme Tasks also runs as the instance "shopping"
      And the admin disabled the instance "shopping"
      When agent 7 opens a session on "nope" and on "shopping" with its credential
      Then agent 7 is told that "nope" does not exist and that "shopping" is unavailable

  Rule: A session belongs to the credential that opened it

    Scenario: An agent cannot continue the session of another agent
      Given user 12 has the role "family", which has the instance "tasks"
      And agent 7 belongs to the admin and may read and write
      And agent 9 belongs to user 12 and may read and write
      When agent 7 continues the session that agent 9 opened on "tasks"
      Then agent 7 is told that the session does not exist

    Scenario: A 17th session of one credential on one instance closes its least recent one there
      Given agent 7 belongs to the admin and may read and write
      When agent 7 opens 17 sessions on "tasks"
      Then the first session of agent 7 no longer exists, and the second one still works

    Scenario: Sessions on other instances do not count against the 16 on an instance
      Given agent 7 belongs to the admin and may read and write
      And Acme Tasks also runs as the instance "shopping"
      And agent 7 has 16 sessions open on "tasks"
      When agent 7 opens a session on "shopping"
      Then all 16 sessions of agent 7 on "tasks" still work

    Scenario: A credential keeps at most 64 sessions across all instances
      Given agent 7 belongs to the admin and may read and write
      And agent 7 has 16 sessions open on each of the instances "tasks", "shopping", "chores" and "errands"
      When agent 7 opens a session on the instance "garden"
      Then the least recent session of agent 7 no longer exists, and the 64 others still work
