@id:listeners
Feature: Listeners
  Core listens on two ports. Agents use the agent port, and the admin uses the portal port.
  Each port serves only its own pages, and each one has a health check.

  Rule: Each listener has only its own pages

    Scenario: The agent port has no portal and no sign-in
      When someone asks the agent port for the portal session and for the sign-in
      Then both are not found

    Scenario: The portal port has no instances and no OAuth
      Given Acme Tasks runs as the instance "tasks"
      When someone asks the portal port for the instance "tasks", for the OAuth description and for a token
      Then all three are not found

    Scenario: Both listeners on one port stop the start
      When the operator restarts the server with both listeners on the port 9000
      Then the server does not start, because the two ports must differ

  Rule: The portal serves a file only by its plain name

    Scenario: A portal file asked for by its plain name is served
      Given the portal has the file "app.js" among its assets
      When someone asks the portal port for the asset "app.js"
      Then they get the file "app.js"

    Scenario: A portal file asked for by a name encoded twice is not served
      Given the portal has the file "app.js" among its assets
      When someone asks the portal port for the asset "app.js" with its name encoded twice
      Then they get the portal page, not the file "app.js"

  Rule: Health checks answer without sign-in

    Scenario: Both health checks answer "ok"
      When someone checks the health of both listeners without a sign-in
      Then both answer only "ok"

  Rule: The public address must be valid

    Scenario: A public address that is not an address stops the start
      When the operator restarts the server with the public address "not a url"
      Then the server does not start, because the public address is not valid

    Scenario: An empty public address counts as not set
      When the operator restarts the server with an empty public address
      Then the server starts and warns that OAuth is off until the public address is set
