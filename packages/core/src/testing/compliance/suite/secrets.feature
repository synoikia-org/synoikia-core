@id:compliance-secrets
Feature: Secrets stay hidden
  Core redacts each secret that it knows before a result reaches the agent, the approver or the audit log.
  Core knows a secret only when the plugin declares it, so a secret that the plugin does not declare can leak.

  Rule: No secret reaches the agent, the approver or the audit log

    Scenario: The secret values of the fake do not reach the agent
      Given the groups of the secret reads are at level read
      When the agent makes each secret read
      Then no secret value of the profile reaches the agent or the audit log

    Scenario: No secret value reaches the approver of a write
      Given the groups of the sample writes are at level ask
      When the agent makes each sample write, and the human reads the approval
      Then no secret value of the profile reaches the approval

    Scenario: The connection test refuses wrong credentials
      When an admin tests the connection with the wrong credentials of the profile
      Then the connection test fails

    Scenario: The manifest names the hosts that the plugin connects to
      When core reads the manifest of the plugin
      Then the manifest names at least one network host
