@id:134
Feature: Metrics for Prometheus
  The operator can let Prometheus read how core is used.
  The operator turns the metrics on and protects them in the deployment.
  The metrics count things. They never show what an agent sent or got.

  Rule: Metrics are off until the operator turns them on

    Scenario: Without a metrics port there are no metrics
      When the operator starts the server without a metrics port
      Then the server opens no metrics port

    Scenario: A metrics port that another listener uses stops the start
      When the operator restarts the server with metrics and the portal both on the port 9000
      Then the server does not start, because the ports must differ

  Rule: A scrape token protects the metrics when the operator sets one

    Scenario: Prometheus with the scrape token reads the metrics
      Given the operator started the server with metrics on the port 9464 and the scrape token "scrape-7f3a"
      When Prometheus reads the metrics with the token "scrape-7f3a"
      Then Prometheus gets the metrics

    Scenario: A reader without the right token is refused
      Given the operator started the server with metrics on the port 9464 and the scrape token "scrape-7f3a"
      When someone reads the metrics with the token "guess-0000"
      Then they are refused as unauthenticated and see no metric

    Scenario: Without a scrape token the metrics are open, and the server says so
      When the operator starts the server with metrics on the port 9464 and no scrape token
      Then the server starts and warns that anyone who reaches the port can read the metrics

  Rule: Prometheus sees what is installed and how it runs

    Scenario: The version of core is shown
      Given the operator started core 0.24.0 with metrics on the port 9464
      When Prometheus reads the metrics
      Then Prometheus reads the version "0.24.0"

    Scenario: The installed plugins and the instances are counted
      Given the operator started the server with metrics on the port 9464
      And Acme Tasks is installed with the instances "tasks" and "chores"
      When Prometheus reads the metrics
      Then Prometheus reads 1 installed plugin and 2 instances

    Scenario Outline: An instance is shown in its state <state>
      Given the operator started the server with metrics on the port 9464
      And the instance "tasks" is <state>
      When Prometheus reads the metrics
      Then Prometheus reads "tasks" as <state>

      Examples:
        | state   |
        | ready   |
        | idle    |
        | stopped |
        | error   |

  Rule: Calls are counted for each instance and outcome

    Scenario: A read that runs at once is counted as done
      Given the operator started the server with metrics on the port 9464
      And agent 7 may read and write the list "Groceries" of the instance "tasks"
      When agent 7 asks for the open tasks of "Groceries"
      Then Prometheus reads 1 call to "tasks" that is done

    Scenario: A refused call is counted as denied
      Given the operator started the server with metrics on the port 9464
      And agent 7 may read and write the list "Groceries" of the instance "tasks"
      And the admin sets the group "tasks" of "tasks" to none
      When agent 7 adds "butter" to "Groceries"
      Then Prometheus reads 1 call to "tasks" that is denied

    Scenario: A call that the upstream fails is counted as failed
      Given the operator started the server with metrics on the port 9464
      And agent 7 may read and write the list "Groceries" of the instance "tasks"
      And Acme refuses every request for lack of permission
      When agent 7 asks for the open tasks of "Groceries"
      Then Prometheus reads 1 call to "tasks" that failed

    Scenario: A call that waits for approval is counted as awaiting approval
      Given the operator started the server with metrics on the port 9464
      And agent 7 may read and write the list "Groceries" of the instance "tasks"
      And the group "tasks" of "tasks" is at level ask
      When agent 7 adds "butter" to "Groceries"
      Then Prometheus reads 1 call to "tasks" that is awaiting approval

  Rule: Prometheus sees how fast calls answer

    Scenario: A call that takes 300 ms falls in the bucket up to 0.5 s
      Given the operator started the server with metrics on the port 9464
      And agent 7 may read and write the list "Groceries" of the instance "tasks"
      And Acme answers after 300 ms
      When agent 7 asks for the open tasks of "Groceries"
      Then Prometheus reads 1 call to "tasks" in the bucket up to 0.5 s, and none up to 0.25 s

  Rule: Prometheus sees how approvals end

    Scenario Outline: An approval that ends as <end> is counted
      Given the operator started the server with metrics on the port 9464
      And agent 7 added "butter" to "Groceries" of the instance "tasks" and waits for approval
      When the approval <action>
      Then Prometheus reads 1 approval for "tasks" that ended as <end>

      Examples:
        | action           | end       |
        | is granted       | approved  |
        | is refused       | denied    |
        | runs out of time | timed out |

  Rule: Prometheus sees who uses core

    Scenario: Users who called in the last hour are counted as active
      Given the operator started the server with metrics on the port 9464
      And agent 7 of the admin and agent 9 of user 2 called "tasks" in the last hour
      When Prometheus reads the metrics
      Then Prometheus reads 2 active users

    Scenario: Sessions are counted by the app that the agent runs in
      Given the operator started the server with metrics on the port 9464
      And agent 7 connected to "tasks" from "claude-code" and agent 9 from "cursor"
      When Prometheus reads the metrics
      Then Prometheus reads 1 session from "claude-code" and 1 from "cursor"

  Rule: Prometheus sees the agent sessions and the sign-ins that fail

    Scenario: Open agent sessions are counted for each instance
      Given the operator started the server with metrics on the port 9464
      And agent 7 and agent 9 each have a session open on "tasks"
      When Prometheus reads the metrics
      Then Prometheus reads 2 open sessions on "tasks"

    Scenario: An agent sign-in with a revoked token is counted as failed
      Given the operator started the server with metrics on the port 9464
      And the admin revoked the token of agent 9
      When agent 9 calls "tasks"
      Then Prometheus reads 1 failed agent sign-in

  Rule: Metrics never show what an agent sent or got

    Scenario: A call with a share password leaves no trace of it in the metrics
      Given the operator started the server with metrics on the port 9464
      And agent 7 may read and write the list "Groceries" of the instance "tasks"
      And the list "Groceries" has the share password "groceries-share-7"
      When agent 7 asks for the share password of "Groceries"
      Then no metric that Prometheus reads contains "groceries-share-7" or "Groceries"
