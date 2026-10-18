@id:server-log
Feature: Server log
  The server log tells the operator why core refused a request, without a secret.
  Each line has a level, and values from outside are quoted and clipped, so nobody can forge a line.

  Background:
    Given Acme Tasks runs as the instance "tasks"

  Rule: The log explains refusals without secrets

    Scenario: A token of another issuer is refused, and the log says why and what to turn on
      When an app sends "tasks" a token of another issuer
      Then the app is asked to sign in
      And the server log warns that the token comes from another issuer, says to turn on the access gateway, and never shows the token

    Scenario: A forged claim with a line break and 10000 characters stays in one quoted, clipped value
      When an app sends "tasks" a token whose issuer holds a line break, a forged log line and 10000 characters
      Then the server log has one line for the refusal, under 1000 characters, and no forged line

    Scenario: An assertion for another application names the claim, and a request without one is a debug line
      Given the access gateway signs people in for core
      And the admin lets "tasks" take only the access gateway
      When an app sends "tasks" an assertion of the access gateway for another application, and then no assertion
      Then the server log warns about the application claim, and logs the request without an assertion only for debugging

  Rule: The log stays readable under noise

    Scenario: Junk tokens are debug lines, and repeats from one address are counted
      When an app sends "tasks" the token "junk" three times, and once more a minute later
      Then the server log has a debug line for the first one, and a line a minute later that counts 2 dropped repeats

    Scenario: A refused origin warns, a new session informs, and a transport error warns
      Given agent 7 belongs to the admin and may read and write
      When agent 7 opens a session from a page of "https://evil.example", then a session, then sends a request without a session
      Then the server log warns about the origin, notes the session, and warns about the transport error, without the credential

    Scenario: A request line shows the path, and never the query
      When a browser opens the OAuth sign-in of the agent port with the state "state-secret-4711"
      Then the server log shows a request line for "/oauth/authorize" without "state-secret-4711"

  Rule: The log level filters lines, and a fault names only its route

    @long-running
    Scenario: At the level "warn", the log has warnings and no debug lines
      When the server runs with the log level "warn", and an app sends a junk token and a token of another issuer
      Then its log has the warning for the token of another issuer, and no debug or info line

    Scenario: A fault logs the route pattern, not the address that was asked for
      Given the operator restarts the server with another master key
      When the admin tries to open the connection of "tasks"
      Then the admin is told only that there was an internal error
      And the server log names the route of the connection, but not the id of "tasks"
