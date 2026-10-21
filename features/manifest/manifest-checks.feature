@id:manifest-checks
Feature: Manifest checks
  Some mistakes pass the manifest schema but would still leak a secret or break a rule.
  The SDK checks the manifest together with plugin.yaml and lists every problem it finds.
  Plugin author 3 runs these checks before a release.

  Background:
    Given plugin author 3 has a plugin folder for "Acme Tasks" with a minimal manifest
    And the plugin connects only to the host of its base address

  Rule: Secret connection fields are hidden, listed and masked

    Scenario: A secret token that the form shows and core does not mask is reported twice
      Given the connection field "token" uses the secret widget, but is not write-only and not listed as sensitive
      When plugin author 3 checks the manifest
      Then the check reports "connection.token: a secret field must be writeOnly"
      And the check reports "connection.token: a secret field must be listed in sensitiveKeys"

    Scenario: A write-only field without the secret widget is reported
      Given the connection field "token" is write-only and listed as sensitive, with no widget
      When plugin author 3 checks the manifest
      Then the check reports only "connection.token: a writeOnly field must use the secret widget"

    Scenario: A token that is hidden, listed and masked passes
      Given the connection field "token" uses the secret widget, is write-only and is listed as sensitive
      When plugin author 3 checks the manifest
      Then the check reports no problems

  Rule: Rules name only existing match profiles

    Scenario: A rule that names a missing match profile is reported
      Given the manifest has the match profile "list-name"
      And plugin.yaml gives "lists.rename" the match profile "list-name" and "lists.archive" the match profile "nope"
      When plugin author 3 checks the manifest
      Then the check reports only 'plugin.yaml rules[1]: matchProfile "nope" is not in the manifest'

  Rule: Result secrets need a core that masks them

    Scenario Outline: A rule with a result secret needs a range that only cores from 0.2.2 meet
      Given the manifest asks for the SDK range "<range>"
      And plugin.yaml marks the whole result of "tokens.create" as secret
      When plugin author 3 checks the manifest
      Then the check reports <problems>

      Examples:
        | range   | problems                                                   |
        | ^0.2.0  | only that "plugin.yaml rules[0]" must "require ^0.2.2"     |
        | >=0.2.0 | only that "plugin.yaml rules[0]" must "require ^0.2.2"     |
        | ^0.2.2  | no problems                                                |

    Scenario: An older range is fine without a result secret
      Given the manifest asks for the SDK range "^0.2.0"
      And plugin.yaml has no rules
      When plugin author 3 checks the manifest
      Then the check reports no problems
