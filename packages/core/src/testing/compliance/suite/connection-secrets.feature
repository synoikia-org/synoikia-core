@id:compliance-connection-secrets
Feature: Connection secrets
  An admin types a connection secret once. Core keeps it encrypted, never shows it again and keeps it out of results.
  Core knows a secret field only from the manifest of the plugin.

  Rule: The manifest marks each secret field of the connection

    Scenario: Each secret field is write-only, hidden and sensitive
      When core reads the manifest of the plugin
      Then each secret field is write-only, uses the secret widget and is a sensitive key
