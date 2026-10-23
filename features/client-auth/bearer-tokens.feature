@id:bearer-tokens
Feature: Agent credentials
  An agent can sign in with a credential that a person makes in the portal.
  The credential belongs to that person, works only on its instances and can expire.

  Rule: A credential is shown once

    Scenario: The admin sees the secret of a new credential only once
      Given Acme Tasks runs as the instance "tasks"
      When the admin makes the credential "kitchen helper" for "tasks"
      Then the admin sees its secret once, and the list of credentials never shows it

    Scenario: A credential for an unknown instance or with a past expiry is refused
      When the admin tries to make a credential for an unknown instance, and one that expired yesterday
      Then the admin is told that the instance is unknown, and that the expiry must be in the future

    Scenario: A revoked credential is asked to sign in, like a made-up one
      Given the instance "tasks" has the list "Groceries" with the open tasks "milk", "bread" and "eggs"
      And agent 7 of the admin has an open session on "tasks"
      When the admin revokes the credential of agent 7
      And agent 7 asks again for the open tasks of "Groceries" in the same session
      Then agent 7 is asked to sign in, as with a made-up credential, and gets no tasks

  Rule: A credential works only on its instances

    Scenario: A credential for one instance has no access on another
      Given user 12 has the role "family", which has the instances "tasks" and "shopping"
      And agent 9 belongs to user 12 with a credential for "tasks" only
      When agent 9 opens a session on "shopping" with its credential
      Then agent 9 is told that its credential is not for "shopping", and is not asked to sign in

    Scenario: No credential or a made-up one is asked to sign in and pointed to OAuth
      Given the server has a public address for agents
      And Acme Tasks runs as the instance "tasks"
      When a stranger opens a session on "tasks" with no credential, and then with a made-up one
      Then the stranger is asked to sign in both times, and pointed to the OAuth description of "tasks"

    Scenario: A credential for all instances follows the instances of the role at each call
      Given agent 9 belongs to user 12, whose role "family" has the instance "tasks"
      And Acme Tasks also runs as the instance "shopping"
      And agent 9 has an open session on "tasks"
      When the admin moves the role "family" from "tasks" to "shopping"
      Then agent 9 is refused at its next call on "tasks", and gets a session on "shopping"

  Rule: A credential expires, and its use is recorded

    Scenario: A credential past its expiry is refused
      Given agent 7 has a credential of the admin that expires in one hour
      And 61 minutes go by
      When agent 7 opens a session on "tasks" with its credential
      Then agent 7 is asked to sign in, as with a made-up credential

    Scenario: The last use of a credential moves at most once a minute
      Given agent 7 belongs to the admin and may read and write
      When agent 7 opens a session on "tasks" now, after 30 seconds and after 90 seconds
      Then the admin sees the last use of agent 7 move only at the first and the third session
