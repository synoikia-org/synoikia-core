@id:proxies
Feature: Reverse proxies
  A reverse proxy in front of core adds the address of the browser to a forwarded list.
  Core reads that list only when the operator says how many proxies to trust.

  Background:
    Given user 12 has the role "family"

  Rule: Only a trusted proxy's address counts

    Scenario: With one trusted proxy, the address that the proxy added counts
      Given the operator trusts the proxy in front of core with the setting "true"
      When user 12 gives a wrong password, and the forwarded list says "6.6.6.6, 203.0.113.9"
      Then the audit log shows a failed sign-in of user 12 from "203.0.113.9"

    Scenario: Without a trusted proxy, the forwarded list is ignored
      When user 12 gives a wrong password, and the forwarded list says "6.6.6.6, 203.0.113.9"
      Then the audit log shows a failed sign-in of user 12 from "127.0.0.1"

    Scenario: A proxy setting of "yes" stops the start
      When the operator restarts the server with the proxy setting "yes"
      Then the server does not start, because the proxy setting must be true, false or a number

  Rule: A trusted proxy tells core that the browser used a secure connection

    Scenario: Behind a trusted proxy, the sign-in of a secure browser is kept only for secure connections
      Given the operator trusts the proxy in front of core with the setting "1"
      When user 12 signs in through a proxy that says the browser used a secure connection
      Then the browser of user 12 keeps its sign-in only for secure connections

    Scenario: Without a trusted proxy, the word of the proxy about the connection is ignored
      When user 12 signs in through a proxy that says the browser used a secure connection
      Then the browser of user 12 keeps its sign-in for any connection
