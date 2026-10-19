@id:access-gateway
Feature: The access gateway
  The access gateway signs people in before their requests reach core, and vouches for each one with a signed assertion.
  Core lets an agent in through the access gateway only for a verified person who matches a user of core.

  Background:
    Given the access gateway signs people in for core
    And the admin lets "tasks" take only the access gateway
    And the admin made the user "me@example.com" with the role "family", which has the instance "tasks"

  Rule: Only a verified assertion about a person counts

    Scenario: The access gateway vouches for a person, also with its team written as an address
      Given the admin writes the team of the access gateway as "https://acme.cloudflareaccess.com/"
      When the access gateway vouches for "me@example.com" on "tasks"
      Then "me@example.com" gets a session on "tasks", and the server log names the caller "external:me@example.com"

    Scenario: An assertion for another application or team, expired, signed with another key or broken is refused
      When the access gateway vouches for "me@example.com" for another application, for another team, too late, with another key, and as garbage
      Then each request is told that the access gateway did not identify the caller

    Scenario: An assertion without an expiry or an issue time is refused
      When the access gateway vouches for "me@example.com" without an expiry, and without an issue time
      Then each request is told that the access gateway did not identify the caller

  Rule: A service credential of the access gateway is not a person

    Scenario: A service credential is refused, even with an address
      When the access gateway vouches for a service credential with the address "me@example.com"
      Then each request is told that the access gateway did not identify the caller

    Scenario: An assertion without an address, or with a service name, is refused
      When the access gateway vouches for a person without an address, and for the name "service:backup"
      Then each request is told that the access gateway did not identify the caller

    Scenario: A request without an assertion is asked to sign in
      When a stranger opens a session on "tasks" with no credential and no gateway identity
      Then the stranger is asked to sign in by the access gateway

  Rule: The access gateway matches only users that the admin or the access gateway made

    Scenario: A user that the admin made matches in any case, and keeps the role
      Given the admin made the user "Boss@example.com" with the role "family", which has the instance "tasks"
      When the access gateway vouches for "boss@example.com" on "tasks"
      Then "boss@example.com" gets a session on "tasks" as the user "Boss@example.com" with the role "family"

    Scenario: A user who signed up is never matched by the access gateway
      Given the admin lets people sign up with the role "viewers"
      And someone signs up as "carol@example.com"
      When the access gateway vouches for "carol@example.com" on "tasks"
      Then the request is told that no account matches, and there is one account "carol@example.com"

  Rule: The access gateway makes accounts only while sign-up is open

    Scenario: An unknown person is refused while sign-up is off
      When the access gateway vouches for "alice@example.com" on "tasks"
      Then the request is told that no account matches, and there is no account "alice@example.com"

    Scenario: An unknown person gets an account with the default role
      Given the access gateway makes accounts with the role "viewers"
      When the access gateway vouches for "alice@example.com" on "tasks"
      Then "alice@example.com" has an account with the role "viewers", made by the access gateway
