@id:compliance-access
Feature: Access levels
  An admin sets the access level of each group of operations. Core reads at level read and runs a write only at level write or ask.
  Core can do this only when the plugin classifies each operation correctly and refuses each call that is not in its catalog.

  Rule: Access levels decide each call of the plugin

    Scenario: Each sample read runs at level read
      Given the groups of the sample reads are at level read
      When the agent makes each sample read
      Then each sample read returns a result

    Scenario: Each sample write is off at level read
      Given the groups of the sample writes are at level read
      When the agent makes each sample write
      Then core refuses each sample write, because the operation is off

    Scenario: A call that is not in the catalog is refused
      When the agent makes each call that the profile names as unknown
      Then core refuses each of those calls
