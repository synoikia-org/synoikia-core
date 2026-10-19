@id:compliance-lock-cases
Feature: A case for each locked operation
  Core runs a locked operation only after a human types its confirmation.
  The suite proves this for each locked operation, so the profile needs a case for each one.

  Rule: The profile has a case for each locked operation of the catalog

    Scenario: Each locked operation of the synced catalog has a case in the profile
      Given core synced the catalog of the plugin
      Then the profile has a case for each locked operation
