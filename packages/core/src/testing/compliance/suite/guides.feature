@id:compliance-guides
Feature: Best-practice guides
  An operation can require that the agent reads its guide before the agent calls it.
  The plugin gives core the guide of each such operation.

  Rule: The plugin provides the guide of each operation that requires one

    Scenario: The agent reads the guide of each operation that requires one
      Given core synced the catalog of the plugin
      When the agent reads the guide of each operation that requires one
      Then each guide has content
