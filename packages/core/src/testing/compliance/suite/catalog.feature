@id:compliance-catalog
Feature: A valid catalog
  Core lists, classifies and describes each operation of the plugin from the catalog that the plugin syncs.
  An admin sets the access level of an operation by its key, and an agent finds it by its description.

  Rule: The plugin starts in core and syncs a valid catalog

    Scenario: The plugin starts and syncs a catalog with operations
      When core starts the plugin
      Then the catalog of the plugin has operations

    Scenario: Each operation has a description
      Given core synced the catalog of the plugin
      Then each operation has a description

    Scenario: Each lock of plugin.yaml names an operation of the catalog
      Given core synced the catalog of the plugin
      When core reads the locks of plugin.yaml
      Then each lock names an operation of the catalog
